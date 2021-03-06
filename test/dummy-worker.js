process.on('uncaughtException', function (e) {
    console.log(e.stack);
});

process.on('unhandledException', function (e) {
    console.log(e.stack);
});

var worker = require('../index.js').worker,
    fs = require('fs'),
    through2 = require('through2');

var count = 0;

worker.on('request', function (req) {
    count++;
    if (req.hasStream) {
        var size = 0;
        req.stream
            .on('data', function (d) {
                //console.log(d.toString());
                size += d.length;
            })
            .on('end', function () {
                console.log('end ? ', size);
                var rS = fs.createReadStream(__dirname + '/stream-b.dat');
                    //.pipe(through2(function (chunck, enc, cb) {
                    //    //totSize += chunck.length;
                    //    this.push(chunck);
                    //
                    //    cb();
                    //}));
                req.data.enhanced = 'this shows its a response';
                req.respond(req.data, rS);
            });
    } else if (req.hasSocket) {
        req.ack();
        req.socket.on('data', function (d) {
            console.log('print data on worker', d.toString());
        });
        req.socket.on('end', function() {
            console.log('socket is finished');
        });
        //var rS = fs.createReadStream(__dirname + '/stream-b.dat');
        //rS.pipe(req.socket);
        req.socket.on('end', function () {
            //rS.close();
        });
        req.socket.end('test');
        req.socket.on('close', function () {});
        req.socket.on('error', function () {});
        //req.socket.write('testouille');
        //req.socket.end('finish');
    } else {
        req.data.enhanced = 'this shows its a response';
        req.respond(req.data);
    }
    //setTimeout((function (count) {
    //    return function () {
    //req.respond({coucou: 'toi', index: count});
    //}
    //})(count), 1000);
});

//var utils = require('../lib/utilities');
//utils.on('test', function () {
//    console.log('event listener');
//});
//utils.once('test', function() {
//    console.log('only once');
//});
//utils.trigger('test', {});
//utils.trigger('test', {});
//worker.on('server', function (d) {
//    console.log(d);
//});
var t = '';
worker.ready();
//if (Math.random() > 0.6) {
//    setTimeout(function () {
//        console.log('Make worker busy');
//        worker.busy();
//    }, 1000);
//}

//var emitData = {foo:Math.random()};
//console.log("worker pid "+process.pid+" emits", emitData);
//worker.emit("myEmit", emitData, function(responseFromSupervisor){
//   console.log("myEmit event", emitData, "received a response", responseFromSupervisor);
//});

//var server = require('http').createServer(function (req, res) {
//    //supervisor.enqueue({test: 'test'}, socket).then(function () {
//    //    console.log(arguments);
//    //});
//    //socket.on('data', function (d) {
//    //    console.log('data', d.toString());
//    //});
//    //socket.on('end', function () {
//    //    console.log('closed');
//    //});
//    //
//    //socket.write('test');
//    //socket.end('test2');
//    //socket.on('request', function (req, res) {
//        console.log('request received on %s', process.pid);
//        res.writeHead(200, {'Content-Type': 'text/plain'});
//        res.end('ok');
//    //});
//});
//server.listen(3100);

//worker.on('softKill', function (done) {
//    setTimeout(done, 2000);
//});