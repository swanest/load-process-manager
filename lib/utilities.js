var listeners = {},
    debug = require('debug')('lpm:utilities'),
    Q = require('q');

function hasListener(eventName) {
    if (listeners[eventName] == void 0 || listeners[eventName].length < 1) {
        debug('No event listener for %s', eventName)
        return false;
    }
    return true;
}

function trigger(eventName, data) {
    if (!hasListener(eventName)) {
        return;
    }
    listeners[eventName].forEach(function (d) {
        if (typeof d === 'function') {
            debug('Calling callback of %s listener', eventName);
            d(data);
        } else if (typeof d.resolve === 'function') {
            debug('Resolving promise of %s listener', eventName);
            d.resolve(data);
        }
    });
}

function on(eventName, cb) {
    if (listeners[eventName] == void 0) {
        listeners[eventName] = [];
    }
    if (cb != void 0) {
        listeners[eventName].push(cb);
    }
    var defer = Q.defer();
    listeners[eventName].push(defer);
    return defer.promise;
}


function removeListeners(eventName) {
    delete listeners[eventName];
}

function once(eventName, cb) {
    if (listeners[eventName] == void 0) {
        listeners[eventName] = [];
    }
    var defer = Q.defer();

    var index = listeners[eventName]
            .push(function (data) {
                if (cb != void 0) {
                    cb(data);
                }
                defer.resolve(data);
                listeners[eventName].splice(index, 1);
            }) - 1;
    return defer.promise;
}

module.exports = {
    trigger: trigger,
    on: on,
    once: once,
    hasListener: hasListener,
    removeListeners: removeListeners
};