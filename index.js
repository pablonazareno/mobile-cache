"use strict";
var HashRing = require("hashring");
var bunyan = require("bunyan");
var logger = bunyan.createLogger({
	name: "meli-cache"
});

var jsdog;

module.exports = function MeliCache(options) {
    jsdog = require("jsdog-meli").configure();
	var self = {};
	var clients = {};
	var name = options.name ? options.name : 'default';
	if (options.namespace) {
		var patchRedis = require('cls-redis');
		patchRedis(options.namespace);
	}
	var redis = require("redis");
	if (process.env.NODE_ENV === 'test') {
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
		var server = client.stream ? client.stream.address() : "";
		logger.debug("CACHE %s: getting key %s from server %j.", name, key, server);
        client.get(key, function(error, value) {
            var total = new Date() - start;
            if (error) {
                jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:fail", "method:get", "cache:" + name, "server:"+server.address]);
                callback(error);
            } else {
                jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:success", "method:get", "cache:" + name, "server:"+server.address]);
                jsdog.recordCompoundMetric("application.mobile.api.cache.result", 1, ["result:" + (value ? "hit" : "miss"), "method:get ", "cache:" + name, "server:"+server.address]);
                callback(undefined, JSON.parse(value));
            }
        });
	};

	self.remove = function(key, callback) {
		var start = new Date();
		var node = self.ring.get(key);
		var client = clients[node];
		var server = client.stream ? client.stream.address() : "";
		logger.debug("CACHE %s: removing key %s from server %j.", name, key, server);
        client.del(key, function(error, value) {
            var total = new Date() - start;
            if (error) {
                jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:fail", "method:remove", "cache:" + name, "server:"+server.address]);
                callback(error);
            } else {
                jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:success", "method:remove", "cache:" + name, "server:"+server.address]);
                callback();
            }
        });
	};

	self.set = function(key, value, ttl, callback) {
		var start = new Date();
		if (typeof ttl === "function") {
			callback = ttl;
		}
		var node = self.ring.get(key);
		var client = clients[node];
		var server = client.stream ? client.stream.address() : "";
		logger.debug("CACHE %s: setting key %s in server %j.", name, key, server);
        client.set(key, JSON.stringify(value), function(error) {
            var total = new Date() - start;
            if (error) {
            //	jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:fail", "method:set", "cache:" + name, "server:"+server.address]);
                callback(error);
            } else {
                if (typeof ttl != "function") {
            //		jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:success", "method:set", "cache:" + name, "server:"+server.address]);
                    client.expire(key, ttl, callback);
                } else {
            //		jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ["result:success", "method:set", "cache:" + name, "server:"+server.address]);
                    callback();
                }
            }
        });
	};

	self.quit = function() {
		require("jsdog-meli").stop();
        options.servers.forEach(function(server) {
			clients[server].end();
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
		logger.warn({err: error && error.message}, "Cache Down");
	});
	return self;
};
