# Spec Delta

## Purpose

Defines how each service resolves a user's roles and permissions from its own MongoDB and enforces them on routes, keeping authorization data separate from Cognito identity.

## ADDED Requirements

### Requirement: Roles come from the service's own MongoDB
The library SHALL look up the authenticated user's roles and permissions in the service's own MongoDB, keyed by the Cognito subject, and SHALL NOT require a shared authorization store.

#### Scenario: User with stored roles
- **WHEN** an authenticated user has a record in the service's authorization collection
- **THEN** the user's roles and permissions from that record are available to handlers

#### Scenario: User with no record
- **WHEN** an authenticated user has no authorization record
- **THEN** the user is treated as having no roles and no permissions

### Requirement: Custom role lookup
The library SHALL allow a service to replace the default lookup with its own function that returns roles and permissions for a user.

#### Scenario: Custom lookup configured
- **WHEN** a service supplies its own lookup
- **THEN** the library uses its result and does not query the default collection

#### Scenario: Lookup fails
- **WHEN** the lookup throws or the database is unavailable
- **THEN** access is denied with a 503 response and no roles are assumed

### Requirement: Role guard
The library SHALL provide a route guard that allows a request only if the user has at least one of the required roles.

#### Scenario: User has the role
- **WHEN** a user with a required role requests a guarded route
- **THEN** the request proceeds

#### Scenario: User lacks the role
- **WHEN** an authenticated user without a required role requests a guarded route
- **THEN** the response is 403

#### Scenario: Unauthenticated user
- **WHEN** an unauthenticated user requests a guarded route
- **THEN** the response is 401 for API requests, or a redirect to login for browser requests

### Requirement: Permission guard
The library SHALL provide a route guard that allows a request only if the user has all of the required permissions.

#### Scenario: User has all permissions
- **WHEN** a user holding every required permission requests a guarded route
- **THEN** the request proceeds

#### Scenario: User lacks one permission
- **WHEN** a user missing any required permission requests a guarded route
- **THEN** the response is 403

### Requirement: Role data is cached briefly
The library SHALL cache a user's resolved roles for a configurable short period to limit database reads, and SHALL allow a service to clear a user's cached roles.

#### Scenario: Repeated requests
- **WHEN** the same user makes several requests within the cache period
- **THEN** roles are read from the database at most once

#### Scenario: Roles changed
- **WHEN** a service clears a user's cached roles after changing them
- **THEN** the next request uses the updated roles
