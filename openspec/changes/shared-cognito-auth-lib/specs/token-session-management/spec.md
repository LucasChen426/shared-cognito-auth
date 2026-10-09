# Spec Delta

## Purpose

Defines how the library validates Cognito tokens, keeps user sessions, and refreshes tokens so users stay signed in without handling tokens themselves.

## ADDED Requirements

### Requirement: Tokens are verified
The library SHALL verify the signature, issuer, audience or client, expiry, and token type of every Cognito token it accepts.

#### Scenario: Valid token
- **WHEN** a token is signed by the configured user pool, is unexpired, and was issued for the service's app client
- **THEN** the token is accepted and the user is authenticated

#### Scenario: Invalid token
- **WHEN** a token has a bad signature, wrong issuer, wrong client, wrong type, or is expired
- **THEN** the token is rejected and the request is treated as unauthenticated

#### Scenario: Signing keys rotate
- **WHEN** a token is signed with a key not yet known to the library
- **THEN** the library fetches the pool's current keys once and verifies the token against them

### Requirement: Browser sessions use an opaque cookie
The library SHALL identify browser sessions with an opaque session ID in a cookie that is HttpOnly, Secure in production, and SameSite, and SHALL NOT place Cognito tokens in the cookie.

#### Scenario: Session cookie attributes
- **WHEN** a session is created
- **THEN** the cookie is HttpOnly and SameSite, is Secure when running in production, and contains no token or user data

### Requirement: Sessions are stored server-side
The library SHALL store session data, including the Cognito tokens, in the service's MongoDB and SHALL remove it when the session ends or expires.

#### Scenario: Session persists across restarts
- **WHEN** a service restarts or a request reaches a different instance
- **THEN** the user's session is still valid

#### Scenario: Expired sessions are removed
- **WHEN** a session passes its expiry
- **THEN** it is no longer accepted and its stored data is removed

### Requirement: Tokens refresh automatically
The library SHALL use the refresh token to obtain new tokens when the access token is expired or about to expire, without user interaction.

#### Scenario: Access token near expiry
- **WHEN** an authenticated request arrives and the access token is within the configured refresh window of expiring
- **THEN** the library obtains new tokens, updates the session, and the request proceeds as authenticated

#### Scenario: Concurrent requests
- **WHEN** several requests for the same session need a refresh at the same time
- **THEN** only one refresh call is made to Cognito and all requests use its result

#### Scenario: Refresh fails
- **WHEN** the refresh token is expired, revoked, or rejected by Cognito
- **THEN** the session is destroyed and the user must log in again

### Requirement: Explicit refresh route
The library SHALL provide a refresh route that lets a client request a token refresh on demand.

#### Scenario: Client-triggered refresh
- **WHEN** an authenticated client calls the refresh route
- **THEN** the session tokens are renewed and a success response is returned

#### Scenario: Refresh without a session
- **WHEN** a client without a valid session calls the refresh route
- **THEN** the response is 401

### Requirement: Bearer tokens are accepted for APIs
The library SHALL authenticate API requests that carry a valid Cognito access token in the Authorization header, without requiring a browser session.

#### Scenario: Valid bearer token
- **WHEN** a request has an `Authorization: Bearer` header with a valid access token
- **THEN** the request is authenticated as the token's user

#### Scenario: Malformed or invalid bearer token
- **WHEN** the Authorization header is malformed or the token is invalid
- **THEN** the response is 401 and no session is created
