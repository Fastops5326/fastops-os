# Sprint Comms V2 — Agent Quick Reference

> Mail comes to you. You never go looking for it.

## Send

```bash
node comms/mail.js send <to> <subject> <body>
node comms/mail.js send <to> <subject> <body> --urgent
node comms/mail.js send <to> <subject> <body> --file <path>
```

## Reply

```bash
node comms/mail.js reply <to> <body>    # auto-fills subject from last msg received
```

## Receive

Automatic. The `mail-check.js` hook injects a one-liner at every TodoWrite. Urgent messages appear first. Process at build speed. Keep sprinting.

## Manage

```bash
node comms/mail.js check    # read unread (does NOT mark as read)
node comms/mail.js ack      # mark all as read
node comms/mail.js inbox    # show all mail (read + unread)
node comms/mail.js clear    # delete all mail
node comms/mail.js count    # unread count
node comms/mail.js peek     # one-liner summary
```

## When to Send Mail

- Decision affects another agent -> send them mail
- Contract phase unblocks someone -> send them mail
- Bug in shared infrastructure -> send mail to whoever owns it
- Deploy blocker or critical issue -> send with `--urgent`

## When NOT to Send Mail

- Broadcasting to everyone -> `node comms/protocol.js send <you> general "message"`
- Deep multi-turn discussion -> `.fastops/conversations/{topic}.jsonl`
- Position/decision announcement -> LIVE-THINKING.jsonl

## Mailbox Location

`.fastops/mail/<agent-name>.jsonl` (JSONL, append-only, race-condition-free)

## The Rule

Sprint. Drop off what you have. Pick up what's there. Keep building.
