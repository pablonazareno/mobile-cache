'use strict';
var HashRing = require('hashring');
var redis = require('redis');
var logger = require('winston');

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
		servers[key] = 1; // balanced ring for now
	}
	self.ring = new HashRing(servers);

	self.get = function(key, callback) {
		var node = self.ring.get(key);
		var client = clients[node];
		logger.debug("CACHE: getting key %s from server %s.",key,client.stream.host)
		client.get(key, callback);
	};

	self.set = function(key, value, ttl, callback) {
		var node = self.ring.get(key);
		var client = clients[node];
		logger.debug("CACHE: setting key %s in server %s.",key,client.stream.host)
		client.set(key, value, function(error) {
			if (typeof ttl === 'function') {
				callback = ttl;
			}
			if (error) {
				callback(error);
			} else {
				if (typeof ttl != 'function') {
					client.expire(key, ttl, callback);
				} else {
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