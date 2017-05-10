/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var assert = require('assert-plus');
var crypto = require('crypto');
var test = require('tape');

var drc = require('..');


// --- globals

var log = require('./lib/log');

var CONFIG;
try {
    CONFIG = require(__dirname + '/config.json').amazonecr;
    assert.object(CONFIG, 'config.json#amazonecr');
    assert.string(CONFIG.repo, 'CONFIG.repo');
    assert.string(CONFIG.tag, 'CONFIG.tag');
    assert.string(CONFIG.username, 'CONFIG.username');
    assert.string(CONFIG.password, 'CONFIG.password');
} catch (e) {
    CONFIG = null;
    log.warn(e, 'skipping Amazon ECR repo tests: ' +
        'could not load "amazonecr" key from test/config.json');
    console.warn('# warning: skipping Amazon ECR private repo tests: %s',
        e.message);
}

var ECR_REGISTRY_VERSION = 'registry/2.0';

// --- Tests

if (CONFIG)
test('v2 amazonecr', function (tt) {
    var client;
    var noauthClient;
    var repo = drc.parseRepo(CONFIG.repo);

    tt.test('  createClient', function (t) {
        noauthClient = drc.createClientV2({
            name: CONFIG.repo,
            log: log
        });
        t.ok(noauthClient);
        t.equal(noauthClient.version, 2);
        t.end();
    });

    tt.test('  supportsV2', function (t) {
        noauthClient.supportsV2(function (err, supportsV2) {
            t.ifErr(err);
            t.ok(supportsV2, 'supportsV2');
            t.end();
        });
    });

    tt.test('  ping', function (t) {
        noauthClient.ping(function (err, body, res) {
            t.ok(err);
            t.ok(res, 'have a response');
            if (res) {
                t.equal(res.statusCode, 401);
                t.ok(res.headers['www-authenticate']);
            }
            t.equal(res.headers['docker-distribution-api-version'],
                ECR_REGISTRY_VERSION);
            t.end();
        });
    });

    /*
     * Test that we need to be logged in to list repo tags.
     */
    tt.test('  listTags (no auth)', function (t) {
        noauthClient.listTags(function (err) {
            t.ok(err);
            t.equal(err.statusCode, 401, 'Expect a 401 status code');
            t.equal(String(err.message).trim(), 'Not Authorizied');
            t.end();
        });
    });

    /*
     * Login using auth.
     */
    tt.test('  createClient', function (t) {
        client = drc.createClientV2({
            name: CONFIG.repo,
            username: CONFIG.username,
            password: CONFIG.password,
            log: log
        });
        t.ok(client);
        t.equal(client.version, 2);
        t.end();
    });

    /*
     * Example expected output:
     *  {
     *      "name": "library/alpine",
     *      "tags": [ "2.6", "2.7", "3.1", "3.2", "edge", "latest" ]
     *  }
     */
    tt.test('  listTags', function (t) {
        client.listTags(function (err, tags) {
            t.ifErr(err);
            t.ok(tags);
            t.equal(tags.name, repo.remoteName);
            t.ok(tags.tags.indexOf(CONFIG.tag) !== -1,
                'no "' + CONFIG.tag + '" tag');
            t.end();
        });
    });

    /*
     *  {
     *      "name": <name>,
     *      "tag": <tag>,
     *      "fsLayers": [
     *         {
     *            "blobSum": <tarsum>
     *         },
     *         ...
     *      ],
     *      "history": <v1 images>,
     *      "signature": <JWS>
     *  }
     */
    var manifest;
    var manifestDigest;
    tt.test('  getManifest', function (t) {
        client.getManifest({ref: CONFIG.tag}, function (err, manifest_, res) {
            t.ifErr(err);
            manifest = manifest_;
            // Note that Amazon ECR does not return a docker-content-digest
            // header.
            manifestDigest = res.headers['docker-content-digest'];
            t.equal(manifestDigest, undefined, 'no docker-content-digest');
            t.ok(manifest);
            t.equal(manifest.schemaVersion, 1);
            t.equal(manifest.name, repo.remoteName);
            t.equal(manifest.tag, CONFIG.tag);
            t.ok(manifest.architecture);
            t.ok(manifest.fsLayers);
            t.ok(manifest.history[0].v1Compatibility);
            t.ok(manifest.signatures[0].signature);
            t.end();
        });
    });

    tt.test('  getManifest (unknown tag)', function (t) {
        client.getManifest({ref: 'unknowntag'}, function (err, manifest_) {
            t.ok(err);
            t.notOk(manifest_);
            t.equal(err.statusCode, 404);
            t.end();
        });
    });

    tt.test('  headBlob', function (t) {
        var digest = manifest.fsLayers[0].blobSum;
        client.headBlob({digest: digest}, function (err, ress) {
            t.ifErr(err);
            t.ok(ress);
            t.ok(Array.isArray(ress));
            var first = ress[0];

            // First request statusCode on a redirect:
            // - ecr.amazonaws.com gives 302 (Found)
            // - docker.io gives 307
            t.ok([200, 302, 303, 307].indexOf(first.statusCode) !== -1,
                'first request status code 200, 302 or 307: statusCode=' +
                first.statusCode);

            // No digest head is returned (it's using an earlier version of the
            // registry API).
            if (first.headers['docker-content-digest']) {
                t.equal(first.headers['docker-content-digest'], digest);
            }

            t.equal(first.headers['docker-distribution-api-version'],
                ECR_REGISTRY_VERSION);

            var last = ress[ress.length - 1];
            t.ok(last);
            t.equal(last.statusCode, 200);

            // Content-Type:
            // - docker.io gives 'application/octet-stream', but amazon isn't so
            //   nice for a HEAD request, it just returns text/plain.
            t.equal(last.headers['content-type'],
                'text/plain; charset=utf-8');

            t.ok(last.headers['content-length']);
            t.end();
        });
    });

    tt.test('  headBlob (unknown digest)', function (t) {
        client.headBlob({digest: 'cafebabe'}, function (err, ress) {
            t.ok(err);
            t.ok(ress);
            t.ok(Array.isArray(ress));
            t.equal(ress.length, 1);

            var res = ress[0];

            // statusCode:
            // - docker.io gives 404, which is what I'd expect
            // - ecr.amazonaws.com gives 405 (Method Not Allowed). Hrm.
            // The spec doesn't specify:
            // https://docs.docker.com/registry/spec/api/#existing-layers
            // t.equal(res.statusCode, 404);

            t.equal(res.headers['docker-distribution-api-version'],
                ECR_REGISTRY_VERSION);

            t.end();
        });
    });

    tt.test('  createBlobReadStream', function (t) {
        var digest = manifest.fsLayers[0].blobSum;
        client.createBlobReadStream({digest: digest},
                function (err, stream, ress) {
            t.ifErr(err);

            t.ok(ress);
            t.ok(Array.isArray(ress));
            var first = ress[0];
            // First request statusCode on a redirect:
            // - ecr.amazonaws.com gives 302 (Found)
            // - docker.io gives 307
            t.ok([200, 302, 307].indexOf(first.statusCode) !== -1,
                'first request status code 200, 302 or 307: statusCode=' +
                first.statusCode);

            // No digest head is returned (it's using an earlier version of the
            // registry API).
            if (first.headers['docker-content-digest']) {
                t.equal(first.headers['docker-content-digest'], digest);
            }

            // Docker-Distribution-Api-Version header:
            t.equal(first.headers['docker-distribution-api-version'],
                ECR_REGISTRY_VERSION);

            t.ok(stream);
            t.equal(stream.statusCode, 200);
            t.equal(stream.headers['content-type'],
                'application/octet-stream');
            t.ok(stream.headers['content-length']);

            var numBytes = 0;
            var hash = crypto.createHash(digest.split(':')[0]);
            stream.on('data', function (chunk) {
                hash.update(chunk);
                numBytes += chunk.length;
            });
            stream.on('end', function () {
                t.equal(hash.digest('hex'), digest.split(':')[1]);
                t.equal(numBytes, Number(stream.headers['content-length']));
                t.end();
            });
            stream.resume();
        });
    });

    tt.test('  createBlobReadStream (unknown digest)', function (t) {
        client.createBlobReadStream({digest: 'cafebabe'},
                function (err, stream, ress) {
            t.ok(err);
            t.ok(ress);
            t.ok(Array.isArray(ress));
            t.equal(ress.length, 1);

            var res = ress[0];

            // statusCode:
            // - docker.io gives 404, which is what I'd expect
            // - ecr.amazonaws.com gives 405 (Method Not Allowed). Hrm.
            // The spec doesn't specify:
            // https://docs.docker.com/registry/spec/api/#existing-layers
            // t.equal(res.statusCode, 404);

            t.equal(res.headers['docker-distribution-api-version'],
                ECR_REGISTRY_VERSION);

            t.end();
        });
    });

    tt.test('  close', function (t) {
        client.close();
        t.end();
    });
});
