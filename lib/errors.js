/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Error classes that docker-registry-client may produce... these
 * plus restify RestError error classes. There isn't a merged
 * base class for all of these currently.
 *
 * TODO: move all usages in this package to these error classes
 * TODO: document and possibly rationalize these separate error trees
 *
 * # Error Hierarchy
 *
 *  verror.VError
 *      restify.HttpError
 *          restify.RestError
 *
 *          # The subset of core restify errors that are used.
 *          restify.BadDigestError
 *          restify.InvalidContentError
 *          ...
 *
 *      # Custom error classes for this package
 *      _DockerRegistryClientBaseError
 *          ManifestVerificationError
 *          ...
 */

var util = require('util'),
    format = util.format;
var assert = require('assert-plus');
var verror = require('verror'),
    VError = verror.VError;



// ---- error classes

/**
 * Base class for custom error classes. This shouldn't be exported,
 * because all usages should be of one of the subclasses.
 *
 * This tries to have a nice Bunyan-y call signature. (Note: I find the
 * strict sprintf handling of varargs to `VError` to be harsh and
 * sometimes surprising, so I avoid that here.)
 *
 *      new MyError('my message');
 *      new MyError(cause, 'my message');
 *      new MyError({err: cause, otherField: 42}, 'my message');
 *      new MyError({otherField: 42}, 'my message');
 *      new MyError('my message with %d formats', arg1, arg2, ...);
 *
 * This also asserts that the error class prototype has a string `code`
 * that is set on the error instance.
 */
function _DockerRegistryClientBaseError() {
    var self = this;
    assert.string(self.constructor.prototype.code,
        self.constructor.name + '.prototype.code');

    var vargs = [];
    var fields;
    var msgArgs;
    if (arguments[0] instanceof Error) {
        // `new <Error>(<err>, ...)`
        vargs.push(arguments[0]); // cause
        if (arguments.length === 1) {
            msgArgs = ['error'];
        } else {
            msgArgs = Array.prototype.slice.call(arguments, 1);
        }
    } else if (typeof (arguments[0]) !== 'object' && arguments[0] !== null ||
            Array.isArray(arguments[0])) {
        // `new <Error>(msg, ...)`
        fields = null;
        msgArgs = Array.prototype.slice.call(arguments);
    } else if (Buffer.isBuffer(arguments[0])) {
        // `new <Error>(buf, ...)`
        // Almost certainly an error, show `inspect(buf)`. See bunyan#35.
        fields = null;
        msgArgs = Array.prototype.slice.call(arguments);
        msgArgs[0] = util.inspect(msgArgs[0]);
    } else {
        // `new <Error>(fields, msg, ...)`
        fields = arguments[0];
        if (fields.err) {
            vargs.push(fields.err); // cause
            delete fields.err;
        }
        msgArgs = Array.prototype.slice.call(arguments, 1);
    }

    vargs.push(format.apply(null, msgArgs));
    VError.apply(this, vargs);

    if (fields) {
        Object.keys(fields).forEach(function (name) {
            self[name] = fields[name];
        });
    }

}
util.inherits(_DockerRegistryClientBaseError, VError);


function InternalError() {
    _DockerRegistryClientBaseError.apply(this, arguments);
}
util.inherits(InternalError, _DockerRegistryClientBaseError);
InternalError.prototype.code = 'InternalError';


function ManifestVerificationError() {
    _DockerRegistryClientBaseError.apply(this, arguments);
}
util.inherits(ManifestVerificationError, _DockerRegistryClientBaseError);
ManifestVerificationError.prototype.code = 'ManifestVerificationError';


function DownloadError() {
    _DockerRegistryClientBaseError.apply(this, arguments);
}
util.inherits(DownloadError, _DockerRegistryClientBaseError);
DownloadError.prototype.code = 'DownloadError';




// ---- exports

module.exports = {
    InternalError: InternalError,
    ManifestVerificationError: ManifestVerificationError,
    DownloadError: DownloadError
};
// vim: set softtabstop=4 shiftwidth=4: