"use strict";
var HashRing = require("hashring");
var bunyan = require("bunyan");
var logger = bunyan.createLogger({
	name: "meli-cache"
});
var jsdog = require("jsdog-meli").configure();

module.exports = function MeliCache(options) {
	var self = {};
	var clients = {};
	if (options.namespace) {
		var patchRedis = require('cls-redis');
		patchRedis(options.namespace);
	}
	var redis = require("redis");
	if (process.env.NODE_ENV==='test'){
		redis = require('redis-mock');
	}
	options.servers.forEach(function(server) {
		var fields = server.split(/:/);
		var clientOptions = options.clientOptions || {};
		var client = redis.createClient(parseInt(fields[1], 10), fields[0], clientOptions);
		clients[server] = client;
	});

	var servers = {};
	for (var key in clients) {
		servers[key] = 1;
	}
	self.ring = new HashRing(servers);

	self.get = function(key, callback) {
		var start = new Date();
		var node = self.ring.get(key);
		var client = clients[node];
		logger.debug("CACHE: getting key %s from server %j.", key, client.stream ? client.stream.address() : "");
		if (client.connected) {
			client.get(key, function(error, value) {
				var total = new Date() - start;
				if (error) {
					jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:fail", "method:get", "db:redis"]);
					callback(error);
				} else {
					jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:success", "method:get", "db:redis"]);
					jsdog.recordCompoundMetric("application.mobile.api.cache.result", 1, ["result:" + (value ? "hit" : "miss"), "method:get ", "db:redis"]);
					callback(undefined, JSON.parse(value));
				}
			});
		} else {
			callback(new Error("Cache Down."));
		}
	};

	self.remove = function(key, callback) {
		var start = new Date();
		var node = self.ring.get(key);
		var client = clients[node];
		logger.debug("CACHE: removing key %s from server %j.", key, client.stream ? client.stream.address() : "");
		if (client.connected) {
			client.del(key, function(error, value) {
				var total = new Date() - start;
				if (error) {
					jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:fail", "method:remove", "db:redis"]);
					callback(error);
				} else {
					jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:success", "method:remove", "db:redis"]);
					callback();
				}
			});
		} else {
			callback(new Error("Cache Down."));
		}
	};

	self.set = function(key, value, ttl, callback) {
		var start = new Date();
		if (typeof ttl === "function") {
			callback = ttl;
		}
		var node = self.ring.get(key);
		var client = clients[node];
		logger.debug("CACHE: setting key %s in server %j.", key, client.stream ? client.stream.address() : "");
		if (client.connected) {
			client.set(key, JSON.stringify(value), function(error) {
				var total = new Date() - start;
				if (error) {
					jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:fail", "method:set", "db:redis"]);
					callback(error);
				} else {
					if (typeof ttl != "function") {
						jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:success", "method:set", "db:redis"]);
						client.expire(key, ttl, callback);
					} else {
						jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:success", "method:set", "db:redis"]);
						callback();
					}
				}
			});
		} else {
			callback(new Error("Cache Down."));
		}
	};

	self.quit = function() {
		options.servers.forEach(function(server) {
			clients[server].quit();
		});
	};

	self.on = function(event, listener) {
		options.servers.forEach(function(server) {
			clients[server].on(event, function() {
				var args = Array.prototype.slice.call(arguments).concat(server);
				listener.apply(undefined, args);
			});
		});
	};

	self.on("error", function(error) {
		logger.warn("Cache Down");
	});
	return self;
};