import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Confetti } from '../src/components/Confetti';
import { ConnectChat } from '../src/components/ConnectChat';
import { useEmailAvailable } from '../src/components/EmailBits';
import { FlowerArt } from '../src/components/FlowerArt';
import { Banner, Body, Button, Card, Chip, Field, H1, Icon, IconCircle, Muted, type IconName } from '../src/components/ui';
import { friendlyDate } from '../src/core/dates';
import { draftsToCommit, handoffToDrafts } from '../src/core/handoff';
import { fallbackInterpret } from '../src/core/fallback-capture';
import { KIND_LABEL } from '../src/core/recommend';
import { suggestSteps } from '../src/core/templates';
import { friendlyAiError } from '../src/lib/api';
import { useStore, uuid } from '../src/lib/store';
import { colors, fonts, KIND_STYLE, radius, shadow } from '../src/theme';

// The welcome walkthrough for new accounts: name → AI chat → email → a hands-on tour → done.
// Every step can be skipped; the step lives in the URL so email sign-in can come back to the right place.

const STEPS = ['hello', 'chat', 'email', 'tour', 'done'] as const;
type Step = (typeof STEPS)[number];

export default function Onboarding() {
  const params = useLocalSearchParams<{ step?: string; connected?: string; email_error?: string }>();
  const store = useStore();
  const step: Step = (STEPS as readonly string[]).includes(params.step ?? '') ? (params.step as Step) : 'hello';
  const index = STEPS.indexOf(step);
  const go = (s: Step) => router.setParams({ step: s, connected: undefined, email_error: undefined });
  const next = () => go(STEPS[Math.min(index + 1, STEPS.length - 1)]);

  const finish = async () => {
    await store.updateProfile({ onboarded_at: new Date().toISOString() }).catch(() => {});
    router.replace('/today');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 8, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, flexDirection: 'row', gap: 6 }} accessibilityLabel={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <Pressable key={s} onPress={() => i < index && go(s)} accessibilityRole="button" accessibilityLabel={`Go to step ${i + 1}`} disabled={i >= index}
              style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= index ? colors.pink : colors.pinkWash }} />
          ))}
        </View>
        {step !== 'done' && (
          <Pressable onPress={finish} accessibilityRole="button" style={{ paddingLeft: 16, paddingVertical: 10 }}>
            <Text style={{ fontFamily: fonts.medium, color: colors.textMuted }}>Skip all</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {step === 'hello' && <Hello onNext={next} />}
        {step === 'chat' && <ChatStep onNext={next} />}
        {step === 'email' && <EmailStep onNext={next} connected={params.connected} error={params.email_error} />}
        {step === 'tour' && <Tour onDone={next} />}
        {step === 'done' && <Done onFinish={finish} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ icon, title, text }: { icon?: IconName; title: string; text: string }) {
  return (
    <View style={{ marginTop: 18, marginBottom: 16 }}>
      {icon && <IconCircle name={icon} color={colors.pink} soft={colors.pinkWash} size={48} />}
      <H1 style={{ marginTop: icon ? 12 : 0 }}>{title}</H1>
      <Muted style={{ fontSize: 15, marginTop: 6 }}>{text}</Muted>
    </View>
  );
}

function Later({ onPress, label = 'I’ll do this later' }: { onPress: () => void; label?: string }) {
  return <Button title={label} variant="ghost" onPress={onPress} />;
}

// ───────────────────────── 1. hello

function Hello({ onNext }: { onNext: () => void }) {
  const store = useStore();
  const [name, setName] = useState(store.profile?.display_name ?? '');
  const save = async () => {
    if (name.trim() && name.trim() !== store.profile?.display_name) await store.updateProfile({ display_name: name.trim().slice(0, 60) }).catch(() => {});
    onNext();
  };
  return (
    <>
      <View style={{ alignItems: 'center', marginTop: 8 }}>
        <FlowerArt slot="celebrate" width={170} height={170} seed={0.9} />
      </View>
      <H1 style={{ textAlign: 'center' }}>Welcome to Momentum</H1>
      <Muted style={{ textAlign: 'center', fontSize: 15, marginTop: 6, marginBottom: 22 }}>
        A calm place for everything on your mind. In the next few minutes you can connect your AI chat and your email, then take a quick tour.
      </Muted>
      <Field label="What should we call you?" value={name} onChangeText={setName} placeholder="Your first name" autoComplete="given-name" textContentType="givenName" onSubmitEditing={save} returnKeyType="next" />
      <Button title="Let’s go" onPress={save} style={{ marginTop: 4 }} />
    </>
  );
}

// ───────────────────────── 2. AI chat

function ChatStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <Header icon="message-circle" title="Connect your AI chat" text="Talk things through with Claude, ChatGPT or another AI. When you’re ready it hands the plan to Momentum, and you review it before anything is added." />
      <ConnectChat compact />
      <Button title="Continue" onPress={onNext} style={{ marginTop: 4 }} />
      <Later onPress={onNext} />
    </>
  );
}

// ───────────────────────── 3. email

function EmailStep({ onNext, connected, error }: { onNext: () => void; connected?: string; error?: string }) {
  const store = useStore();
  const available = useEmailAvailable();
  const [providers, setProviders] = useState<{ gmail: boolean; outlook: boolean; imap: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { store.emailProviders().then(setProviders).catch(() => setProviders(null)); }, [store.emailProviders]);
  useEffect(() => {
    if (connected) { setNotice(`${connected === 'gmail' ? 'Gmail' : 'Outlook'} is connected. Your recent mail is syncing.`); store.refresh().then(() => store.emailSync(true)).catch(() => {}); }
    else if (error) setNotice('That inbox didn’t connect. You can try again, or do it later from Settings.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, error]);

  const connect = async (p: 'gmail' | 'outlook') => {
    try { await store.emailConnect(p, '/onboarding?step=email'); } catch (e) { setNotice(friendlyAiError(e)); }
  };

  return (
    <>
      <Header icon="mail" title="Bring your email along" text="Momentum reads recent mail to write a short daily digest, spot requests that should become tasks, and keep newsletters out of your way. It never sends or deletes email." />
      {notice && <Banner text={notice} />}
      {store.emailAccounts.map((a) => (
        <Card key={a.id} style={{ backgroundColor: colors.tealSoft, borderColor: colors.tealSoft, paddingVertical: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconCircle name="check" color={colors.white} soft={colors.teal} size={30} />
            <Body style={{ flex: 1, fontFamily: fonts.medium }} numberOfLines={1}>{a.email_address}</Body>
          </View>
        </Card>
      ))}
      {available === false ? (
        <Card style={{ alignItems: 'center', paddingVertical: 22 }}>
          <Icon name="mail" size={24} color={colors.textFaint} />
          <Body style={{ fontFamily: fonts.medium, marginTop: 8 }}>Email isn’t switched on yet</Body>
          <Muted style={{ textAlign: 'center', marginTop: 4 }}>Everything else works without it. It will show up in Settings when it’s ready.</Muted>
        </Card>
      ) : (
        <Card>
          <Body style={{ fontFamily: fonts.medium, marginBottom: 4 }}>{store.emailAccounts.length ? 'Add another inbox' : 'Choose your email'}</Body>
          <Muted style={{ marginBottom: 6 }}>You can connect as many as you like: personal, work, side projects.</Muted>
          {providers?.gmail && <Button title="Gmail" icon="mail" variant="soft" onPress={() => connect('gmail')} style={{ marginTop: 8 }} />}
          {providers?.outlook && <Button title="Outlook / Microsoft 365" icon="inbox" variant="soft" onPress={() => connect('outlook')} style={{ marginTop: 8 }} />}
          {providers?.imap && (
            <Button title={providers.gmail ? 'iCloud, Yahoo or another inbox' : 'Gmail, iCloud, Yahoo or another inbox'} icon="server" variant="soft" onPress={() => router.push({ pathname: '/email-accounts', params: { add: '1' } })} style={{ marginTop: 8 }} />
          )}
          {providers?.imap && !providers.gmail && <Muted style={{ marginTop: 8 }}>These connect with an app password from your email provider; the next screen shows where to make one.</Muted>}
        </Card>
      )}
      <Button title="Continue" onPress={onNext} style={{ marginTop: 4 }} />
      {!store.emailAccounts.length && <Later onPress={onNext} />}
    </>
  );
}

// ───────────────────────── 4. tour

const TOUR = ['today', 'capture', 'project', 'areas', 'chat'] as const;

function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const slide = TOUR[i];
  const last = i === TOUR.length - 1;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18 }}>
        <Muted style={{ flex: 1, fontFamily: fonts.medium }}>Quick tour · {i + 1} of {TOUR.length}</Muted>
        <Pressable onPress={onDone} accessibilityRole="button" hitSlop={8}><Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep }}>Skip tour</Text></Pressable>
      </View>
      {slide === 'today' && <TourToday />}
      {slide === 'capture' && <TourCapture />}
      {slide === 'project' && <TourProject />}
      {slide === 'areas' && <TourAreas />}
      {slide === 'chat' && <TourChat />}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
        {i > 0 && <Button title="Back" variant="ghost" onPress={() => setI(i - 1)} style={{ flex: 1 }} />}
        <Button title={last ? 'Finish the tour' : 'Next'} onPress={() => (last ? onDone() : setI(i + 1))} style={{ flex: 2 }} />
      </View>
    </>
  );
}

const TODAY_EXAMPLES: { kind: keyof typeof KIND_STYLE; text: string; why: string }[] = [
  { kind: 'meaningful_move', text: 'Draft the cover page', why: 'Moves a project you care about forward' },
  { kind: 'time_sensitive', text: 'Pay the car registration', why: 'Due Friday, and it can’t move' },
  { kind: 'easy_momentum', text: 'Reply to Maya', why: '5 minutes, an easy win to get going' },
  { kind: 'quietly_waiting', text: 'Clear one garage shelf', why: 'Untouched for two weeks' },
];

function TourToday() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <>
      <Header title="Today picks a few things for you" text="Instead of a long list, Today suggests one of each kind. Tap a card to see why it was picked, or use Next on any card to see another." />
      {TODAY_EXAMPLES.map((e, n) => {
        const st = KIND_STYLE[e.kind];
        return (
          <Card key={e.kind} onPress={() => setOpen(open === n ? null : n)} accessibilityLabel={`${KIND_LABEL[e.kind]}: ${e.text}`} style={{ paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconCircle name={st.icon as IconName} color={st.color} soft={st.soft} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1, color: st.color }}>{KIND_LABEL[e.kind].toUpperCase()}</Text>
                <Body style={{ fontFamily: fonts.medium }}>{e.text}</Body>
                {open === n && <Muted style={{ marginTop: 2 }}>{e.why}</Muted>}
              </View>
              <Icon name={open === n ? 'chevron-up' : 'chevron-down'} color={colors.textMuted} />
            </View>
          </Card>
        );
      })}
      <Muted style={{ marginBottom: 10 }}>Use the filter chips on Today to see only one kind, like quick wins on a tired day.</Muted>
    </>
  );
}

function TourCapture() {
  const store = useStore();
  const [text, setText] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const goals = store.goals.filter((g) => ['active', 'waiting', 'blocked'].includes(g.status));
  const preview = useMemo(() => (text.trim() ? fallbackInterpret(text, store.lifeAreas, goals).items : []), [text, store.lifeAreas, goals]);
  const area = (id: string | null) => store.lifeAreas.find((a) => a.id === id)?.name;

  const add = async () => {
    setBusy(true);
    try {
      const drafts = preview.map((p) => ({ ...p, meaning: '', client_id: uuid() }));
      await store.commitCapture(text, 'text', null, draftsToCommit(drafts));
      setAdded(preview.length === 1 ? `Added “${preview[0].title}”. You’ll find it on Today.` : `Added ${preview.length} items. You’ll find them on Today.`);
      setText('');
    } catch (e) {
      setAdded(`Couldn’t add it: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header title="Add anything, in your own words" text="Type or speak the way you’d say it. Momentum splits it up, spots dates and how long things take, and files each one in a life area. Try it:" />
      <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 }, shadow]}>
        <TextInput value={text} onChangeText={(t) => { setText(t); setAdded(null); }} multiline placeholder="Call Julie about the lease by Friday and book a dentist cleaning"
          placeholderTextColor={colors.textFaint} accessibilityLabel="Try adding something"
          style={{ fontFamily: fonts.body, fontSize: 16, color: colors.text, minHeight: 64, textAlignVertical: 'top' }} />
      </View>
      {preview.map((p, n) => {
        const bits = [p.kind === 'goal' ? 'Project' : p.kind === 'accomplishment' ? 'Already done' : 'Task'];
        if (p.estimated_minutes) bits.push(`${p.estimated_minutes} min`);
        if (p.deadline) bits.push(`${p.deadline_type === 'hard' ? 'due' : 'by'} ${friendlyDate(p.deadline)}`);
        const a = area(p.suggested_life_area_id);
        if (a) bits.push(a);
        return (
          <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
            <Icon name={p.kind === 'goal' ? 'folder' : p.kind === 'accomplishment' ? 'check-circle' : 'arrow-right-circle'} color={colors.teal} size={18} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontFamily: fonts.medium }}>{p.title}</Body>
              <Muted>{bits.join(' · ')}</Muted>
            </View>
          </View>
        );
      })}
      {added && <Banner text={added} />}
      {preview.length > 0 && <Button title={preview.length === 1 ? 'Add it to my list' : `Add these ${preview.length}`} variant="soft" onPress={add} loading={busy} style={{ marginBottom: 6 }} />}
      <Muted style={{ marginBottom: 10 }}>The Capture tab at the bottom of the screen opens this any time.</Muted>
    </>
  );
}

function TourProject() {
  const store = useStore();
  const [title, setTitle] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = title.trim().length > 2 ? suggestSteps(title.trim(), [], 5) : null;

  const start = async () => {
    setBusy(true);
    try {
      const [draft] = handoffToDrafts([{ kind: 'project', title: title.trim(), steps: plan!.steps.map((s) => ({ title: s.title, minutes: s.minutes })) }], store.lifeAreas, []);
      await store.commitCapture(title, 'goal', null, draftsToCommit([{ ...draft, client_id: uuid() }]));
      setMade(`“${draft.title}” is ready in To-dos with ${plan!.steps.length} first steps.`);
      setTitle('');
    } catch (e) {
      setMade(`Couldn’t create it: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header title="Big things become small steps" text="A project is an outcome, like “move apartments” or “launch my website”. Momentum suggests first steps for it. Type one to see:" />
      <Field value={title} onChangeText={(t) => { setTitle(t); setMade(null); }} placeholder="Plan a weekend trip to Portland" accessibilityLabel="A project you want to get done" />
      {plan && (
        <Card style={{ paddingVertical: 12 }}>
          <Muted style={{ fontFamily: fonts.medium, marginBottom: 6 }}>Starter steps for a {plan.template.label.toLowerCase()}</Muted>
          {plan.steps.map((s) => (
            <View key={s.title} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 }}>
              <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.pinkSoft }} />
              <Body style={{ flex: 1 }}>{s.title}</Body>
              <Muted>{s.minutes} min</Muted>
            </View>
          ))}
          <Button title="Start this project" variant="soft" onPress={start} loading={busy} style={{ marginTop: 10 }} />
        </Card>
      )}
      {made && <Banner text={made} />}
      <Muted style={{ marginBottom: 10 }}>You can edit or remove any step later. Your AI chat can also plan a project with you.</Muted>
    </>
  );
}

function TourAreas() {
  const store = useStore();
  const areas = store.lifeAreas.filter((a) => !a.archived_at);
  return (
    <>
      <Header title="Life areas keep it balanced" text="Every task and project sits in a part of your life. Momentum files things automatically from the words you use, and you can teach it your own words in Settings → Life Areas." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
        {areas.map((a) => <Chip key={a.id} label={a.name} color={a.color} selected onPress={() => {}} />)}
      </View>
      <Card style={{ paddingVertical: 12 }}>
        {[['“Book a dentist cleaning”', 'Health'], ['“Pay the electric bill”', 'Finances'], ['“Reply to Maya about Saturday”', 'Relationships']].map(([t, a]) => (
          <View key={t} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
            <Body style={{ flex: 1 }}>{t}</Body>
            <Icon name="arrow-right" size={16} color={colors.textMuted} />
            <Text style={{ fontFamily: fonts.medium, color: colors.pinkDeep, marginLeft: 8, width: 110, textAlign: 'right' }}>{a}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

function TourChat() {
  return (
    <>
      <Header title="Your AI hands off, you decide" text="When your AI chat sends a plan, it shows up at the top of Today as “From chat”. Open it, edit anything, and add it, or discard it." />
      <Card style={{ backgroundColor: colors.lavenderSoft, borderColor: colors.lavenderSoft, paddingVertical: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconCircle name="message-circle" color={colors.lavender} soft={colors.white} size={40} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontFamily: fonts.medium }}>From Claude: 4 items to review</Body>
            <Muted numberOfLines={2}>Getting ready for the move on the 15th and catching up on a few loose ends.</Muted>
          </View>
          <Icon name="chevron-right" color={colors.textMuted} />
        </View>
      </Card>
      <Muted style={{ marginBottom: 10 }}>Celebrate as you go: checking things off fills your rings on Today and your history in Progress.</Muted>
    </>
  );
}

// ───────────────────────── 5. done

function Done({ onFinish }: { onFinish: () => void }) {
  const store = useStore();
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => setReduceMotion(true)); }, []);
  const name = store.profile?.display_name;
  return (
    <>
      {!reduceMotion && <Confetti width={width} height={height} origin={{ x: 0.5, y: 0.3 }} count={60} />}
      <View style={{ alignItems: 'center', marginTop: 20 }}>
        <FlowerArt slot="celebrate" width={190} height={190} seed={1.6} />
      </View>
      <H1 style={{ textAlign: 'center' }}>You’re all set{name ? `, ${name}` : ''}</H1>
      <Muted style={{ textAlign: 'center', fontSize: 15, marginTop: 6, marginBottom: 22 }}>
        Start by adding whatever is on your mind, or ask your AI chat to help you sort it out. Small steps, big change.
      </Muted>
      <Button title="Go to Today" onPress={onFinish} />
      <Muted style={{ textAlign: 'center', marginTop: 10 }}>You can replay the tour or connect apps any time in Settings.</Muted>
    </>
  );
}
