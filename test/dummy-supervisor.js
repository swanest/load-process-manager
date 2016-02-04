process.on('uncaughtException', function (e) {
    console.log(e.stack);
});

process.on('unhandledException', function (e) {
    console.log(e.stack);
});

var supervisor = require('../index.js').supervisor({
    worker: {
        file: __dirname + '/dummy-worker.js',
        count: 2
    }
});

supervisor.on('SIGINT', function () {
    console.log('SIGINT received through supervisor');
    supervisor.softKill(function () {
        console.log('soft kill done')
    }).then(function () {
        console.log('soft kill done promised')
    });
});

supervisor.on('online', function () {
    console.log('All workers are online');
    setTimeout(function () {
        for (var i = 0; i < 10; i++) {
            supervisor.enqueue({salut: 'salue'}).then((function (i) {
                return function (r) {
                    console.log(i, r);
                }
            })(i));
        }
    }, 2000);
});

supervisor.start();