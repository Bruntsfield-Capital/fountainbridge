'use client';

import { useState, useTransition } from 'react';
import { setFounderMessages } from '@/app/actions/founder-messages';
import { MESSAGE_WORDS } from '@/lib/founder-message';

/**
 * The founder's switch for the messages about their team's work (FB-279): one quiet line at the foot
 * of "Needs you", beside the line for this device's notifications. The choice is kept on the server,
 * because the email is sent from there and must obey it.
 */
export function MessagesSwitch({ ventureId, initialOff, email, byEmail }: { ventureId: string; initialOff: boolean; email: string; byEmail: boolean }) {
  const [off, setOff] = useState(initialOff);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const press = () => startTransition(async () => {
    setMessage(null);
    const turnOn = off;
    const r = await setFounderMessages(ventureId, turnOn);
    if (r.ok) setOff(!turnOn);
    else setMessage(r.message);
  });

  return (
    <p className="push-line muted" data-testid={off ? 'messages-off' : 'messages-on'}>
      {off ? MESSAGE_WORDS.off : byEmail ? MESSAGE_WORDS.onWithEmail(email) : MESSAGE_WORDS.onWithoutEmail}
      <button type="button" className="btn" data-testid={off ? 'messages-start' : 'messages-stop'} disabled={pending} onClick={press}>
        {off ? MESSAGE_WORDS.start : MESSAGE_WORDS.stop}
      </button>
      {message ? <span className="push-offer-error" role="alert">{message}</span> : null}
    </p>
  );
}

/** When the studio could not read the choice: said, rather than drawn as a switch in a guessed state. */
export function MessagesUnread() {
  return <p className="push-line muted" data-testid="messages-unread">{MESSAGE_WORDS.unread}</p>;
}
