"use strict";

const _ = require('lodash'),
    fs = require('fs-extra'),
    logger = require('winston'),
    path = require('path'),
    squirrel = require('squirrel'),
    crypto = require('crypto'),
    utils = require('./utils'),
    sharp = require('sharp'),

    SCRIPT_FILE = 'scripts/screenshot.js',
    DEF_ENGINE = 'phantomjs',
    DEF_COMMAND = 'phantomjs',
    DEF_FORMAT = 'png',
    IMIN_MODULES = [
        'imagemin', 'imagemin-gifsicle', 'imagemin-jpegtran', 'imagemin-optipng', 'imagemin-svgo'
    ],
    IMIN_OPTIONS = {
        allowInstall: true
    };

/* Configurations and options */

function outputFile(options, conf) {
    const json = JSON.stringify(options),
        sha1 = crypto.createHash('sha1').update(json).digest('hex'),
        format = options.format || DEF_FORMAT;
    //return conf.storage + path.sep + sha1 + '.' + format;

    //NOTE: We are create a sub directory with first 2 character of generated hash file
    //And storing file into that directory to avoid maximum file storage limitation of a
    //single directory
    var sub = sha1.substring(0, 2);
    return conf.storage + path.sep + sub + path.sep + sha1 + '.' + format;
}

function cliCommand(config) {
    const engine = config.engine || DEF_ENGINE,
        command = config.command || config.commands[engine][process.platform];
    return command || DEF_COMMAND;
}

function createOptions(options, config) {
    const opts = _.omit(options, ['force', 'callback']);
    opts.url = utils.fixUrl(options.url);
    return _.defaults(opts, config.options);
}

function createConfig(options, config) {
    const conf = _.cloneDeep(config),
        engine = options.engine;
    conf.engine = engine || conf.engine;
    return conf;
}

/* Image processing */

function minimizeImage(src, dest, cb) {
    squirrel(IMIN_MODULES, IMIN_OPTIONS, (err, Imagemin) => {
        const safeCb = (err) => {
            if (err) {
                logger.error(err);
            }
            cb();
        };

        if (err) {
            safeCb(err);
        } else {
            const imin = new Imagemin().src(src).dest(dest).use(Imagemin.jpegtran({progressive: true})).use(Imagemin.optipng({optimizationLevel: 3})).use(Imagemin.gifsicle({interlaced: true})).use(Imagemin.svgo());

            imin.run(safeCb);
        }
    });
}

/* Resize Screenshot */
function imageResize(outputFile, opts, cb) {

    let ow = _.get(opts, 'ow', 600);
    let oh = _.get(opts, 'oh', 1012);

    logger.info('Image Resizing...');
    sharp(outputFile).resize(ow, oh).toBuffer(outputFile, (err, buffer) => {

        if (err) {
            logger.error('Error in image resizing..');
            cb();
        }
        logger.debug('Image Resizing Done Successfully...');
        fs.writeFile(outputFile, buffer, function(e) {

            if (e) {
                logger.error('Error writing resized image in file..');
                cb();
            }
            logger.info('Writing Resized File Done Successfully...');
            cb();
        });

    });

}

/* Screenshot capturing runner */

function runCapturingProcess(options, config, outputFile, base64, onFinish) {
    const scriptFile = utils.filePath(SCRIPT_FILE),
        command = cliCommand(config).split(/[ ]+/),
        cmd = _.union(command, [scriptFile, base64, outputFile]),
        opts = {
            timeout: config.timeout
        };

    logger.debug('Options for script: %s, base64: %s, command: %s', JSON.stringify(options), base64, JSON.stringify(cmd));

    utils.execProcess(cmd, opts, (error) => {
        if (config.compress) {
            minimizeImage(outputFile, config.storage, () => onFinish(error));
        } else {
            //onFinish(error);
            logger.info(outputFile, 'Resizing a file....');
            imageResize(outputFile, options, () => onFinish(error));
        }
    });
}

/* External API */

function screenshot(options, config, onFinish) {
    const conf = createConfig(options, config),
        opts = createOptions(options, config),
        base64 = utils.encodeBase64(opts),
        file = outputFile(opts, conf),

        retrieveImageFromStorage = () => {
            logger.debug('Take screenshot from file storage: %s', base64);
            onFinish(file);
        },
        retrieveImageFromSite = () => {
            runCapturingProcess(opts, conf, file, base64, (error) => {
                logger.debug('Process finished work: %s', base64);
                return onFinish(file, error);
            });
        };

    logger.info('Capture site screenshot: "%s"', options.url);

    if (options.force || !conf.cache) {
        retrieveImageFromSite();
    } else {
        fs.exists(file, (exists) => exists
            ? retrieveImageFromStorage()
            : retrieveImageFromSite());
    }
}

/* Exported functions */

module.exports = {
    screenshot: screenshot
};
