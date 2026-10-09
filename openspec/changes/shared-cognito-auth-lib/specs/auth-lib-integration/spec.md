# Spec Delta

## Purpose

Defines how a service installs, configures, and adopts the library with minimal code, and the documentation that supports adoption.

## ADDED Requirements

### Requirement: Installable from npm
The library SHALL be installable with a single npm install command and usable from Node.js projects without additional build steps.

#### Scenario: Install and import
- **WHEN** a developer installs the package in a supported Node.js project
- **THEN** the library can be imported and used with no extra tooling

### Requirement: Single configuration object
The library SHALL be set up through one configuration object that contains the Cognito settings and the service's MongoDB handle, with sensible defaults for everything else.

#### Scenario: Minimal setup
- **WHEN** a service supplies only the required Cognito settings and a database handle
- **THEN** login, callback, logout, refresh, verification, and role lookup all work with defaults

#### Scenario: Optional overrides
- **WHEN** a service sets optional values such as route prefix, cookie name, session lifetime, or refresh window
- **THEN** the library uses those values

### Requirement: Configuration is validated at startup
The library SHALL validate its configuration when created and fail with a message naming every missing or invalid setting.

#### Scenario: Missing required setting
- **WHEN** a required setting such as the user pool ID or client ID is missing
- **THEN** startup fails with an error that names the missing setting

#### Scenario: Secrets are not logged
- **WHEN** configuration errors or normal logs are written
- **THEN** client secrets, tokens, and session IDs do not appear in the output

### Requirement: Integration with Express applications
The library SHALL provide its routes and guards in a form that mounts into an Express application with only a few lines of code.

#### Scenario: Protect an application
- **WHEN** a developer mounts the library's routes and middleware and adds a role guard to a route
- **THEN** the route requires login and the role without further code

### Requirement: Developer guide
The project SHALL include a guide that lets a developer integrate the library without reading its source.

#### Scenario: Guide contents
- **WHEN** a developer opens the guide
- **THEN** it covers installation, Cognito setup, configuration reference, the MongoDB roles schema, a working quick-start, SSO setup across services, and troubleshooting of common errors

### Requirement: Runnable example
The project SHALL include an example application that demonstrates login, a protected route, a role-guarded route, and logout.

#### Scenario: Run the example
- **WHEN** a developer supplies Cognito and MongoDB settings and starts the example
- **THEN** they can complete login, reach the protected routes according to their roles, and log out
