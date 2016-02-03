var expect = require("chai").expect;

it('should require the library properly', function () {
    var lpm = require('../index.js');
    expect(lpm).to.be.keys('worker', 'supervisor');
});

it('should create a dummy worker instance in a callback style', function (done) {
    var supervisor = require('../index.js').supervisor({
        worker: {
            path: 'dummy-worker.js'
        }
    });

    supervisor.start();
    supervisor.on('ready', done);
});

it('should create a dummy worker instance in a promised style', function (done) {
    var supervisor = require('../index.js').supervisor({
        worker: {
            path: 'dummy-worker.js'
        }
    });

    supervisor.start();
    supervisor.on('ready').then(done);
});

it('some supervisor methods should accept callbacks', function (done) {
    var supervisor = require('../index.js').supervisor({
        worker: {
            path: 'dummy-worker.js'
        }
    });

    supervisor.start();
    supervisor.on('ready', done);
});

it('should create multiple dummy workers', function (done) {
    var supervisor = require('../index.js').supervisor({
        worker: {
            path: 'dummy-worker.js',
            count: 5
        }
    });

    supervisor.start();
    supervisor
        .on('ready')
        .then(function () {

        });
});