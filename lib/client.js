var debug = require('debug')('mobile-cache::client');
var asyncu = require('async-utils');

var NOT_READY_ERROR = 'the client is not ready';

var Client = module.exports = function Client(clientOptions) {
	var self = this;
	
	if (!(self instanceof Client)) return new Client(clientOptions);

	self.server_name = 'unkwnown';
	
	//defaults
	clientOptions.client_timeout = clientOptions.client_timeout || 50;
	clientOptions.socket_keepalive = true;
	clientOptions.enable_offline_queue = true;
	clientOptions.no_ready_check = false;
	clientOptions.socket_nodelay = true;
	
	self.client_options = clientOptions;

	self.connect();
}

Client.prototype.connect = function() {
	var self = this;

	var redis = require('redis');
	self.jsdog = require('jsdog-meli').configure();

	if (process.env.MOBILE_REDIS === 'mock') {
		redis = require('redis-mock');
	}	

	var clientOptions = self.client_options;
	
	debug('creating redis client with options: %j', clientOptions);
	
	self.redis_client = redis.createClient(clientOptions.port, clientOptions.host, clientOptions);
	self.server_name = self.redis_client.stream && self.redis_client.stream.remoteAddress || 'unkwnown';
	self.ready = false;

	self.redis_client.on('ready', function() {
		debug('server %s connected and ready', self.server_name);
		self.ready = true;
	})

	if (clientOptions.heartbeat) {
		setInterval(function() {
			client.ping(function noop() {});
		}, clientOptions.heartbeat);
	}
}

Client.prototype.get = function(key, callback) {
	var self = this;
	
	if (!self.ready) {
		return callback(NOT_READY_ERROR);
	}

	var start = new Date();
	
	debug('getting key %s from server %s', key, self.server_name);
	
	self.redis_client.get(key, asyncu.fuse(self.client_options.client_timeout, function(error, value) {
		
		var total = new Date() - start;
		var opResult = error && 'fail' || 'success';

		self.jsdog.recordCompoundMetric('application.mobile.api.cache.time', total, [
			'result:'+ opResult,
			'method:get',
			'cache:' + self.client_options.name,
			'server:' + self.server_name
		]);
		
		if (error) {
			debug('error while getting key %s. %j',key, error);
			return callback(error);
		}
		
		var result = value ? 'hit' : 'miss';

		self.jsdog.recordCompoundMetric('application.mobile.api.cache.result', 1, [
			'result:' + result,
			'method:get',
			'cache:' + self.client_options.name,
			'server:' + self.server_name
		]);
		
		debug('successful get key %s [result: %s] value: %s', key, result, value);
		
		return callback(undefined, JSON.parse(value));
	}));
}

Client.prototype.del = function(key, callback) {
	var self = this;

	if (!self.ready) {
		return callback(NOT_READY_ERROR);
	}
	
	var start = new Date();

	debug('removing key %s from server %s', name, key, self.server_name);
	
	self.redis_client.del(key, asyncu.fuse(self.client_options.client_timeout, function(error, value) {
		
		var total = new Date() - start;
		var opResult = error && 'fail' || 'success';

		self.jsdog.recordCompoundMetric('application.mobile.api.cache.time', total, [
			'result:' + opResult,
			'method:remove',
			'cache:' + self.client_options.name,
			'server:' + self.server_name
		]);

		if (error) {
			return callback(error);
		}

		return callback();
	}));
};

//retrocompatibility
Client.prototype.remove = Client.prototype.del;

Client.prototype.set = function(key, value, ttl, callback) {
	var self = this;
	
	if (!self.ready) {
		return callback(NOT_READY_ERROR);
	}

	var start = new Date();

	if (typeof ttl === 'function') {
		callback = ttl;
		ttl = undefined;
	}

	debug('setting key %s in server %s', key, self.server_name);

	self.redis_client.set(key, JSON.stringify(value), asyncu.fuse(self.client_options.client_timeout, function(error) {
		var total = new Date() - start;
		var opResult = error && 'fail' || 'success';

		self.jsdog.recordCompoundMetric('application.mobile.api.cache.time', total, [
			'result:' + opResult,
			'method:set',
			'cache:' + self.client_options.name,
			'server:' + self.server_name
		]);

		if (error) {
			return callback(error);
		}

		if (ttl) {
			return self.redis_client.expire(key, ttl, callback);
		}

		return callback();
	}));
};

Client.prototype.expire = function(key, ttl, callback) {
	var self = this;
	if (!self.ready) {
		return callback(NOT_READY_ERROR);
	}
	debug('setting expire for key %s in server %s', key, self.server_name);
	self.redis_client.expire(key, ttl, asyncu.fuse(self.client_options.client_timeout, callback));
};

Client.prototype.quit = function() {
	debug('quit client %s', this.server_name);
	require('jsdog-meli').stop();
	this.redis_client.end();
};

Client.prototype.reconnect = function() {
	debug('reconnect client %s', this.server_name);
	this.redis_client.quit();
	this.ready = false;
	this.connect();
};

Client.prototype.on = function(event, listener) {
	var self = this;
	self.redis_client.on(event, function() {
		var args = Array.prototype.slice.call(arguments).push(self.server_name);
		listener.apply(undefined, args);
	});
};
