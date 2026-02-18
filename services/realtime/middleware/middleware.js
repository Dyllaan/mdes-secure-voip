const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

function setupMiddleware(app, config) {
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                connectSrc: ["'self'", ...config.cors.origin]
            }
        }
    }));

    app.use(cors(config.cors));
    app.use(require('express').json({ limit: '10kb' }));

    const apiLimiter = rateLimit({
        windowMs: config.security.apiRateLimitWindow,
        max: config.security.apiRateLimitMax,
        message: { error: 'Too many requests, please try again later' },
        standardHeaders: true,
        legacyHeaders: false
    });
    app.use(apiLimiter);

    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
        next();
    });
}

module.exports = setupMiddleware;