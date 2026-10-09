# Spec Delta

## Purpose

Defines single sign-on behavior across multiple services that share one Cognito user pool, so users sign in once and move between applications without signing in again.

## ADDED Requirements

### Requirement: Single sign-on across services
Services that use the same Cognito user pool SHALL let a user who has signed in to one service reach another without entering credentials again, while each service keeps its own session.

#### Scenario: Second application after sign-in
- **WHEN** a user signed in to service A opens service B, which has no session for them
- **THEN** service B's login redirect completes without a credentials prompt and service B creates its own session

#### Scenario: Sessions are independent
- **WHEN** a user's session in service A expires or is destroyed
- **THEN** the user's session in service B is not affected

### Requirement: Each service uses its own app client
The library SHALL be configured per service with that service's own Cognito app client, and SHALL reject tokens issued for a different app client.

#### Scenario: Token from another service
- **WHEN** service B receives a token issued for service A's app client
- **THEN** service B rejects the token

### Requirement: Logout ends the shared sign-in
The library SHALL end the user's Cognito sign-in on logout so the user is not silently signed back in to any service.

#### Scenario: Logout then visit another service
- **WHEN** a user logs out of service A and then opens service B without a session
- **THEN** service B requires the user to enter credentials

#### Scenario: Other services keep their local session
- **WHEN** a user logs out of service A while service B has a valid local session
- **THEN** service B's session remains valid until it expires or is refreshed unsuccessfully

### Requirement: Identity is consistent across services
The library SHALL identify a user by the same Cognito subject in every service, so each service can link its own authorization data to it.

#### Scenario: Same user in two services
- **WHEN** the same person signs in to two services
- **THEN** both services see the same user subject
