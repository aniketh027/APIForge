'use strict';
// Trusted preload: keep the exact generated server bytes, but constrain its TCP listener.
const net = require('net');
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (port, callback) {
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid live listener');
    return listen.call(this, Number(port), '127.0.0.1', callback);
};
