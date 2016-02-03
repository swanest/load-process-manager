var childProcess = require('child_process');

var p = childProcess.fork(__dirname + '/dummy-worker.js');

p.on('message', function (data) {
    console.log(data);
})