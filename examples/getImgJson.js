#!/usr/bin/env node

/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var drc = require('../');
var mainline = require('./mainline');

// Shared mainline with examples/foo.js to get CLI opts.
var cmd = 'getImgJson';
mainline({cmd: cmd}, function (log, parser, opts, args) {
    if (!args[0] || (args[0].indexOf(':') === -1 && !args[1])) {
        console.error('usage:\n' +
            '    node examples/%s.js REPO:TAG\n' +
            '    node examples/%s.js REPO IMAGE-ID\n' +
            '\n' +
            'options:\n' +
            '%s', cmd, cmd, parser.help().trimRight());
        process.exit(2);
    }


    // The interesting stuff starts here.
    var client;
    if (args[0].indexOf(':') !== -1) {
        // Lookup by REPO:TAG.
        var rat = drc.parseRepoAndTag(args[0]);
        client = drc.createClient({
            scheme: rat.index.scheme,
            name: rat.canonicalName,
            agent: false,
            log: log,
            username: opts.username,
            password: opts.password
        });
        client.getImgId({tag: rat.tag}, function (err, imgId) {
            if (err) {
                mainline.fail(cmd, err);
            }
            client.getImgJson({imgId: imgId}, function (aErr, imgJson, res) {
                if (aErr) {
                    mainline.fail(cmd, aErr);
                }
                console.log(JSON.stringify(res.headers, null, 4));
                console.log(JSON.stringify(imgJson, null, 4));
            });
        });

    } else {
        // Lookup by REPO & IMAGE-ID.
        client = drc.createClient({
            name: args[0],
            agent: false,
            log: log,
            username: opts.username,
            password: opts.password
        });
        client.getImgJson({imgId: args[1]}, function (aErr, imgJson, res) {
            if (aErr) {
                mainline.fail(cmd, aErr);
            }
            console.log(JSON.stringify(res.headers, null, 4));
            console.log(JSON.stringify(imgJson, null, 4));
        });
    }


});
