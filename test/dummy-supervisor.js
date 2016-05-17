var fs = require('fs'),
    stream = require('stream'),
    through2 = require('through2'),
    net = require('net'),
    server;

process.title = 'lpm';

console.log('exec');

process.on('uncaughtException', function (e) {
    console.log(e.stack);
});

process.on('unhandledException', function (e) {
    console.log(e.stack);
});

//console.log(process.cwd());

var supervisor = require('../index.js').supervisor({
    worker: {
        file: __dirname + '/dummy-worker.js',
        count: 4
    }
});

//supervisor.on('SIGINT', function () {
//    console.log('SIGINT received through supervisor');
//    supervisor.hardKill();
//    //supervisor.softKill(function () {
//    //    console.log('soft kill done')
//    //}).then(function () {
//    //    console.log('soft kill done promised')
//    //});
//});

//supervisor.on("myEmit", function(req){
//    console.log("supervisor received an emit from worker pid"+req.pid, req.data, req.id, "now reponds:");
//    req.respond({foo:req.data.foo*10});
//});

supervisor.on('online', function () {
    console.log('All workers are online');
    //supervisor.enqueue({salut: 'salue'}).then(function () {
    //    console.log(arguments);
    //});

    //var w = new stream.Readable();
    //w._read = function () {};
    //w.push('Salut c\'est A');
    //w.push('Salut c\'est A');
    //w.push('Salut c\'est A');
    //w.push('Salut c\'est A');
    ////w.end();
    //supervisor.enqueue({streamTest: 'test'}, w);
    //
    //var w2 = new stream.Readable();
    //w2._read = function () {};
    //w2.push('Salut c\'est B');
    //w2.push('Salut c\'est B');
    //w2.push('Salut c\'est B');
    ////w2.end();
    //supervisor.enqueue({streamTest: 'test'}, w2);
    var totProcessed = 3,
        conusmmed = 0;

    process.title = 'node-master';
    console.time('startProcess');

    //setInterval(function () {
    //    supervisor.enqueue({test: 'test'});
    //}, 1000);

    for (var i = 0; i < totProcessed; i++) {
        setTimeout(function (i) {
            return function () {
                var rS = fs.createReadStream(__dirname + '/stream.dat');
                supervisor.enqueue({streamTest: 'test' + i}, rS).then(function (response) {
                    console.log('response for the stream ' + i, response.data);
                    response.stream
                        .on('data', function (d) {
                            conusmmed += d.length;
                        })
                        .on('end', function () {
                            totProcessed--;
                            console.log('finished ' + i, response.data, process.memoryUsage());
                            console.log('remaining ' + totProcessed);
                            if (totProcessed <= 0) {
                                console.timeEnd('startProcess');
                                console.log('processed bytes', conusmmed * 2);
                            }
                        });
                });
            }
        }(i), i * 10);
    }

    //for (var i = 0; i < totProcessed; i++) {
    //    setTimeout(function (i) {
    //        return function () {
    //            var content = fs.readFileSync(__dirname + '/stream.dat', {encoding: 'utf8'});
    //            supervisor.enqueue({streamTest: 'test' + i, content: content}).then(function (response) {
    //                console.log('response for the stream ' + i, response.data);
    //
    //                totProcessed--;
    //                console.log('finished ' + i, response.data, process.memoryUsage());
    //                console.log('remaining ' + totProcessed);
    //                if (totProcessed <= 0) {
    //                    console.timeEnd('startProcess');
    //                    console.log('processed bytes', conusmmed * 2);
    //                }
    //            });
    //        }
    //    }(i), i * 10);
    //}
    //supervisor.enqueue({streamTest: 'test2'}, fs.createReadStream(__dirname + '/stream-b.dat')).then(function (response) {
    //    console.log('response for the stream 2', response.data);
    //});
    //supervisor.enqueue({streamTest: 'test3'}, fs.createReadStream(__dirname + '/stream.dat')).then(function (response) {
    //    console.log('response for the stream 3', response.data);
    //});
    //supervisor.enqueue({streamTest: 'test4'}, fs.createReadStream(__dirname + '/stream-b.dat')).then(function (response) {
    //    console.log('response for the stream 4', response.data);
    //});

    //setTimeout(function () {
    //    for (var i = 0; i < 10; i++) {
    //        supervisor.enqueue({salut: 'salue'}).then((function (i) {
    //            return function (r) {
    //                console.log(i, r);
    //            }
    //        })(i));
    //    }
    //}, 2000);

    //for (var i = 0; i < 10; i++) {
    //    net.connect(3100, function () {
    //
    //    });
    //}

    //supervisor.broadcast('server', {}, server);

});

supervisor.start();