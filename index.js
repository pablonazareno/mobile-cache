'use strict';
var HashRing = require('hashring');
var redis = require('redis');
var logger = require('winston');
var jsdog = require("jsdog-meli").configure();

module.exports = function MeliCache(options) {
	var self = {};
	var clients = {};
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
		logger.debug("CACHE: getting key %s from server %s.", key, client.stream.host)
		client.get(key, function(error, value) {
			var total = new Date() - start;
			if (error) {
				jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ['result:fail', 'method:get', 'db:redis']);
			} else {
				jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ['result:success', 'method:get', 'db:redis']);
			}
			callback(error, JSON.parse(value));
		});
	};

	self.set = function(key, value, ttl, callback) {
		var start = new Date();
		var node = self.ring.get(key);
		var client = clients[node];
		logger.debug("CACHE: setting key %s in server %s.", key, client.stream.host)
		client.set(key, JSON.stringify(value), function(error) {
			var total = new Date() - start;
			if (typeof ttl === 'function') {
				callback = ttl;
			}
			if (error) {
				jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ['result:fail', 'method:set', 'db:redis']);
				callback(error);
			} else {
				if (typeof ttl != 'function') {
					jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ['result:success', 'method:set', 'db:redis']);
					client.expire(key, ttl, callback);
				} else {
					jsdog.recordCompoundMetric("application.mobile.api.cache.time", total, ['result:success', 'method:set', 'db:redis']);
					callback();
				}
			}
		});
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
	return self;
};