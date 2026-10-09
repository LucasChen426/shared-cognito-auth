# Spec Delta

## Purpose

Defines how a service built on the library signs users in and out through AWS Cognito and exposes the authenticated identity, without the service handling user passwords.

## ADDED Requirements

### Requirement: Login redirects to Cognito
The library SHALL start a login by redirecting the browser to the Cognito hosted sign-in page using the authorization code flow with PKCE.

#### Scenario: Unauthenticated browser starts login
- **WHEN** a user without a session requests the login route
- **THEN** the browser is redirected to the Cognito sign-in page with a state value and a PKCE challenge

#### Scenario: Return path is preserved
- **WHEN** a user is sent to login after requesting a protected page
- **THEN** after a successful login the user is returned to that originally requested page

### Requirement: Callback completes login
The library SHALL complete login on the callback route by exchanging the authorization code for tokens and creating a session for the user.

#### Scenario: Valid callback
- **WHEN** Cognito redirects back with a valid code and matching state
- **THEN** a session is created and the user is redirected to the return path

#### Scenario: State mismatch
- **WHEN** the callback state does not match the one issued at login
- **THEN** the library rejects the request with a 400 response and creates no session

#### Scenario: Cognito returns an error
- **WHEN** Cognito redirects back with an error parameter or the code exchange fails
- **THEN** the library rejects the request, creates no session, and does not expose Cognito error details to the user

### Requirement: Logout ends the session
The library SHALL end the user's local session and sign the user out of Cognito when the logout route is requested.

#### Scenario: Logout
- **WHEN** an authenticated user requests the logout route
- **THEN** the local session is destroyed, the session cookie is cleared, and the user is redirected to Cognito logout and then to the configured post-logout URL

#### Scenario: Logout without a session
- **WHEN** a user without a session requests the logout route
- **THEN** the user is redirected to the configured post-logout URL without error

### Requirement: Authenticated user is available to handlers
The library SHALL make the authenticated user's identity (subject, email, name, and Cognito groups when present) available to request handlers.

#### Scenario: Authenticated request
- **WHEN** a request carries a valid session
- **THEN** the handler can read the user's identity from the request

#### Scenario: Unauthenticated request to a protected route
- **WHEN** a request without a valid session or token reaches a protected route
- **THEN** browser requests are redirected to login and API requests receive a 401 response

### Requirement: Login routes are mounted automatically
The library SHALL provide the login, callback, logout, and refresh routes as a single mountable unit so a service does not implement them.

#### Scenario: Mount under a custom prefix
- **WHEN** a service mounts the routes under a chosen path prefix
- **THEN** all four routes are served under that prefix and the callback URL matches the one registered in Cognito
