'use strict';

// Config
const slsAuth = require('serverless-authentication');

const config = slsAuth.config;
const utils = slsAuth.utils;

// Providers
const facebook = require('serverless-authentication-facebook');
const google = require('serverless-authentication-google');
const microsoft = require('serverless-authentication-microsoft');

// Common
const crypto = require('crypto');
const cache = require('../storage/cacheStorage');
const users = require('../storage/usersStorage');

const helpers = require('../helpers');

const createResponseData = helpers.createResponseData;
const redirectProxyCallback = helpers.redirectProxyCallback;

function createUserId(data, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  return hmac.digest('hex');
}

/**
 * Callback Handler
 * @param proxyEvent
 * @param context
 */
function callbackHandler(proxyEvent, context) {
  const event = {
    provider: proxyEvent.pathParameters.provider,
    stage: proxyEvent.requestContext.stage,
    host: proxyEvent.headers.Host,
    code: proxyEvent.queryStringParameters.code,
    state: proxyEvent.queryStringParameters.state
  };

  const providerConfig = config(event);

  /**
   * Error response
   * @param error
   */
  function errorResponse(error) {
    utils.errorResponse(
      error,
      providerConfig,
      (err, response) => redirectProxyCallback(context, response)
    );
  }

  /**
   * Token response
   * @param data
   */
  function tokenResponse(data) {   
    const stateObject = JSON.parse(Buffer.from(event.state, 'base64').toString('utf8'));

    console.log('state: ' + JSON.stringify(stateObject));

    utils.tokenResponse(
      data,
      providerConfig,
      (err, response) => redirectProxyCallback(context, response, stateObject.origin, stateObject.query)
    );
  }

  /**
   * Handles the response
   * @param error
   * @param profile
   * @param state
   */
  const handleResponse = (error, profile, state) => {
    if (error) {
      // Error response if something went wrong at the first place
      errorResponse({ error: 'Unauthorized' });
    } else {
      cache.revokeState(state)
        .then(() => {
          // workaround for DynamoDb - we can't save attributes with empty string values.
          // Google may return certain attributes as empty string - get rid of the here.
          delete profile['_raw'];

          const id = createUserId(`${profile.provider}-${profile.id}`, providerConfig.token_secret);
          const data = createResponseData(id, providerConfig);
          users.saveUser(Object.assign(profile, { userId: id }))
            .then((userContext) => {
              // saveUser can optionally return an authorizer context map
              // see http://docs.aws.amazon.com/apigateway/latest/developerguide/use-custom-authorizer.html
              if (typeof userContext === 'object' && !Array.isArray(userContext)) {
                data.authorizationToken.payload = Object.assign(
                  data.authorizationToken.payload || {},
                  userContext);
              }
              return cache.saveRefreshToken(id, data.authorizationToken.payload);
            }).then(result => tokenResponse(Object.assign(data, { refreshToken: result })))
            .catch(_error => errorResponse({ error: _error }));
        }).catch(_error => errorResponse({ error: _error }));
    }
  };

  switch (event.provider) {
  case 'facebook':
    facebook.callbackHandler(event, providerConfig, handleResponse);
    break;
  case 'google':
    google.callbackHandler(event, providerConfig, handleResponse);
    break;
  case 'microsoft':
    microsoft.callbackHandler(event, providerConfig, handleResponse);
    break;
  default:
    errorResponse({ error: 'Invalid provider' });
  }
}

exports = module.exports = callbackHandler;
