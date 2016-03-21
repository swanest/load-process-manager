# load-process-manager

load-process-manager is tiny library that eases the hassle of handling and managing child process. It will also spread
requests across workers in an efficient way taking into account the pressure of the workers (RSS memory usage at the moment)

## Breaking change since v1.x
 * LPM handles Streams v3 (parent -- > child / child -- > parent) and
 * Sending sockets to children
 * The callback of the requests responses will now give a `Response` object instead of just the responded payload

So therefore LPM now works only with node `>= v0.12.x`

## Example

Master process:
```js

var supervisor = require('load-process-manager').supervisor({
    worker: {
        file: __dirname + '/dummy-worker.js',
        count: 2
    }
});

supervisor.on('SIGINT', function () {
    console.log('SIGINT received through supervisor');
    // supervisor.hardKill(); // Will kill children without waiting them to end their requests
    supervisor.softKill(function () {
        // Callback style
        console.log('soft kill done');
    }).then(function () {
        // Promise style
        console.log('soft kill done promised')
    });
});

supervisor.on('online', function () {
    console.log('All workers are online');
    for (var i = 0; i < 10; i++) {
        console.log('Enqueing a new request with payload %o', {Hello: 'World'});
        // A new request in enqued with the payload {Hello: 'World'}
        supervisor.enqueue({Hello: 'World'}).then(function (r) {
            // Here we get the answer
            console.log('Answer received from worker: %o', r);
        });
    }
});

// Let's start our workers (2 in this case)
supervisor.start();
```

Child process:
```js
var worker = require('load-process-manager').worker;

worker.on('request', function (req) {
    console.log('Received a new request with payload: %o',req.data);
    // Wait 2 seconds before replying
    setTimeout(function () {
        req.respond({dummy:'world'});
    }, 2000);
});
// Notify the master that worker is ready to accept requests
worker.ready();
```

## API
### Supervisor (aka master process)
 * Config object by default (can be overwritten):
```js
{
    request: {
        timeout: -1, // -1 = deactivated, otherwise integer in ms
        retries: 0
    }
    worker: {
        count: 1, // How many workers should be maintained
        restarts: 5, // Maximum 5 restarts within 120seconds
        maxRestartsInInterval: 120
    }
}
```
 * `supervisor.enqueue(payload, streamOrSocket, options, callback)` (thenable)
   * Adds a task to the queue and try to assign it to a worker.
   * options by default: `{timeout: config.timeout, retries: config.retries}`
   * The callback receives a `Response` object with the following API:
     * `.data` property with the response data received over IPC
     * `.id` id of the request ([UUID-V4](https://en.wikipedia.org/wiki/Universally_unique_identifier))
     * `.createdAt` `hrtime` of when the request was originally enqueued
     * `.hasStream` self explanatory
     * `.stream` gain access to the stream sent by the child
 * `supervisor.health()` returns an array with a per child `pid`, `rss`, and heap memory usage like:
```js
[
 {pid: 1234, rss: 21827584, heapTotal: 7556896, heapUsed: 4371152 },
 {pid: 1234, rss: 21827584, heapTotal: 7556896, heapUsed: 4371152 }
]
```
 * `supervisor.softKill( [callback] ) [.then(callback)]` kills child processes and the master process but it will wait until all requests are finished first (if `on('softKill',...)` is not implemented in the workers) this is the clean way of kill children. (NB: children will not accept any new incoming requests. Only custom events can be sent back and forth)
 * `supervisor.hardKill()` kills children and the master without waiting for requests to end (ie: useful in development)
 * `supervisor.on('eventName' [, callback]) [.then(callback)]` listens for an event to happen and will call `callback` when event will fire, one of `callback` or `.then(callback)` is mandatory. Available events:
   * `'SIGINT'` is the same as `process.on('SIGINT')` but the supervisor already handles SIGINT messages to kill children (hardly) and then kill itself. If you implement it then this behaviour is removed
   * online - will fire when children have all called `worker.ready()`
   * a custom event emitted by children with the `Request` passed
 * `supervisor.broadcast('eventOfYourChoice' [, payload])` will broadcast an event to the children processes with the `payload` passed. If no `payload` is passed then children will get `undefined` as the first callback argument.

### Worker
 * `worker.on('eventName' [, callback]) [.then(callback)]` listens for an event to happen and will call `callback` when event will fire, one of `callback` or `.then(callback)` is mandatory. Available events:
   * `'request'` will fire when there is an incoming request coming from the master process. The callback will have an object of type `Request` has first argument and has the following API:
     * `req.data` will give you the payload send via the supervisor (aka master)
     * `req.respond([object answer])` replies to the original request.
     * `req.id` will return the ID of the request, a generated `UUIDv4` is used
     * `req.createdAt` will return `hrtime` of when the request has been created
     * `req.hasStream`self explanatory
     * `req.hasSocket` self explanatory
     * `req.stream` accessor to the stream sent by the parent
     * `req.socket` accessor to the socket sent by the parent
     * `req.ack()` just acknowledge that the request has been handled and that the parent can continue sending stuff
    * `'softKill', doneCallback` will fire when the master process called `supervisor.softKill()` if you implement it, then you need to call the `doneCallback` function when finished otherwise the process will stay alife endlessly. If you don't implement it, then the process will die when all requests have been answered
    * 'hardKill' will fire when master has called `supervisor.hardKill()` that will not prevent the process to die and will die straightly after the event has been fired.
    * a custom event emitted by the parent with the payload associated.
  * `worker.ready()` notifies the parent that the worker is ready to accept incoming requests (THIS IS MANDATORY - otherwise nothing will happen)
  * `worker.emit('eventOfYourChoice' [, payload] [, callback])` will emit an event to it's parent with the given `payload`. If no `payload` is passed then the parent will get `undefined` as `Request.data`.
  * `worker.busy()` tells the supervisor that the child will not accept any new incoming request. To make the flow work normally again, call `worker.ready()` again. NB: when processes are `softKilled` the child that has called `busy()` will not die until it's `ready()` again.
  * `worker.requests()` returns an `array` of the ongoing requests where each element is a `Request` object. Note that this array is a copy of the real one and doesn't let you alter it. On the other hand it lets you use the API's of ongoing requests.

## TODO
 * Implement `supervisor.resize(n)` to dynamically resize (add or delete) the number of current workers.