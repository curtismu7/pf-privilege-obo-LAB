<!--
  All the WORDING for the OBO video (two parts). Edit the text under each heading, nothing else needs to change.
  take.py reads this file and fills in live values around it; it never writes this file. SCRIPT.md is the source for every claim here:
  a sentence with no source tag in SCRIPT.md does not belong in this file.

  Rules for editing safely:
  - Don't rename a "# Opening Slide" / "# Closing Slide" / "# Slide: <key>" / "# Step: <key>" heading, and don't rename a
    "## Title" / "## Text" / "## Lead" / "## Verdict" / "## Image" / "## Column A: ..." / "## Column B: ..." heading.
  - A "## Column A: <label>" or "## Column B: <label>" label IS shown on the slide as that column's heading.
  - Keep each bullet under a column on its own line starting with "- ".
  - "---" on its own line separates one section from the next.
  - No slide is held longer than 10 seconds (owner, 2026-11-22): keep each slide to about 40 words (lead, bullets and verdict).
  - This repo is public: no host names, client ids or user names here. The take shows the real ones on screen; the lab's .env holds them.
  - The "# Slide: observability" section holds the wording around the rows; take.py fills the bullets from the run's own capture.
-->

# Opening Slide

## Title
Acting for a person: who is asking?

## Lead
One token can name the person and the agent. Two ways to get it.

## Column A: Obvious way
- The agent uses its own credentials
- The person disappears

## Column B: This demo
- The person stays the subject
- The agent is named beside them

## Verdict
Every call in this video is a live run.

---

# Slide: rfc8693

## Title
RFC 8693: token exchange

## Lead
Send a token that proves the person. Get a new one back.

## Column A: What it can carry
- act: the current actor
- audience: where it will be used

## Column B: What a receiver does
- If aud is present and the receiver is not named, reject the token (RFC 7519)

## Verdict
The agent keeps its identity and acts for the person.

---

# Slide: contrast1

## Title
Same chain so far. One question left.

## Lead
Who makes the exchange?

## Column A: Part 1, the agent
- The agent exchanges at PingFederate
- Privilege checks the result

## Column B: Part 2, the gateway as well
- The agent still exchanges
- The gateway makes a second exchange for the backend

## Verdict
Next: the second exchange.

---

# Slide: console_obo

## Title
How the door is set up: Auth Mode OBO

## Lead
Read from the Privilege console. Read only.

## Column A: The app
- Auth Mode is obo
- The backend is our resource server

## Column B: Its OBO settings
- The gateway's own client and a token URL
- A resource and a scope

## Verdict
The client secret is write-only. It is never shown.

---

# Slide: contrast2

## Title
Side by side

## Lead
Who is the current actor?

## Column A: Part 1, at the door
- The person is the subject
- The agent is the actor

## Column B: Part 2, at the backend
- The person is the subject
- The gateway is the actor, the agent is in the trail

## Verdict
RFC 8693 section 4.1: the current actor counts; earlier ones are history.

---

# Slide: observability

## Title
What these two runs left behind (an excerpt, ids masked)

## Lead
Each row: time, layer, and how we know.

## Column A: Rows
- filled from this run's capture

## Column B: Where the logs live
- filled from this run's capture

## Verdict
A row is never inferred from a missing line. Not logged means no line was found.

---

# Slide: sample_note

## Title
SAMPLE: a stand-in, not a live run

## Lead
This preview runs the same page against a stand-in. Tokens are samples.

## Column A: What is real
- The page, captions and timing

## Column B: What is simulated
- PingFederate, the gateway, the backend

## Verdict
The live take uses the real tenant.

---

# Closing Slide

## Title
The person stays the subject. The actor is named.

## Lead
Privilege records the person and pins the agent. Who exchanges is a choice.

## Column A: What you saw
- Part 1: the agent exchanged
- Part 2: the gateway did too

## Column B: More
- The Mock tab shows refusals not possible live

## Verdict
Both shapes, a refusal in each.

---

# Step: sample_opening_verdict

## Title
Sample opening line

## Text
This is a sample: the calls are answered by a stand-in, not a live tenant.

---

# Step: sample_closing_lead

## Title
Sample closing line

## Text
This sample showed the page and its captions. The live take shows the real tenant.

---

# Step: p1_intro

## Title
Part 1: the agent exchanges

## Text
Agent-side. The agent trades the person's ID token for an access token, then calls the door.

---

# Step: p1_run

## Title
One run, then a refusal

## Text
The run signs in, exchanges and calls the door. It also tries the same call with a made-up token.

---

# Step: p1_signin

## Title
The person signs in

## Text
The ID token's subject is the person. It is valid for a few minutes only.

---

# Step: p1_exchange

## Title
The agent asks for an access token

## Text
These are the parameters as sent: the grant type, the subject token, where it will be used, and the scope. No actor token is sent.

---

# Step: p1_token

## Title
sub is the person. act names the agent.

## Text
The subject stays the person and act.sub is the agent. PingFederate writes act from its own mapping. The audience is the door.

---

# Step: p1_door

## Title
The door accepts it

## Text
The door is set to check the issuer, the audience, the required actor and the lifetime. The accepted call is how the lab knows it passed.

---

# Step: p1_tools

## Title
Three tools came back

## Text
This key's grant gives this token's scope the three read tools.

---

# Step: p1_refused_frame

## Title
The same call with a made-up token

## Text
Nothing about the token is valid. This frame is the door's answer.

---

# Step: p1_refused

## Title
Refused with a challenge

## Text
HTTP 401 with a WWW-Authenticate challenge, as HTTP requires. It includes resource_metadata, the URL of the door's metadata.

---

# Step: p2_intro

## Title
Part 2: the gateway exchanges too

## Text
Gateway OBO. The same person and the same agent, but the door is set to Auth Mode OBO.

---

# Step: p2_run

## Title
Run it, with a refusal

## Text
The run ends with the same made-up token, this time against the gateway's door.

---

# Step: p2_exchange

## Title
The agent exchanges for this door

## Text
This request sends resource. Part 1 sent audience. PingFederate accepted each for its own door.

---

# Step: p2_door

## Title
The gateway makes its own exchange

## Text
The agent calls the door with this token. The gateway checks it, then makes a second exchange for the backend.

---

# Step: p2_whoami

## Title
The backend reports what it received

## Text
It verified the token itself. The subject is the person, the audience is the backend, and act holds the gateway with the agent nested inside.

---

# Step: p2_act

## Title
Current actor, and the trail

## Text
Per RFC 8693 section 4.1 a receiver looks at the current actor. Here that is the gateway's client. The agent is in the trail.

---

# Step: p2_refused_frame

## Title
A made-up token again

## Text
Same control, against the gateway's door.

---

# Step: p2_refused

## Title
Refused, same kind of challenge

## Text
HTTP 401 with a challenge that points at this door's metadata.
