require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BASE = 'https://services.leadconnectorhq.com';

async function ghlGet(token, endpoint) {
  const url = `${BASE}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${endpoint}`);
  return res.json();
}

// ─── Expert Analysis Engine ───────────────────────────────────────────────────

function analyzeWorkflows(workflows) {
  const issues = [];
  const active  = workflows.filter(w => w.status === 'published');
  const draft   = workflows.filter(w => w.status === 'draft');

  const names = workflows.map(w => (w.name || '').toLowerCase());
  const hasOnboarding   = names.some(n => n.includes('onboard') || n.includes('welcome') || n.includes('new client'));
  const hasLeadFollowUp = names.some(n => n.includes('lead') && (n.includes('follow') || n.includes('nurture') || n.includes('sequence')));
  const hasAppointment  = names.some(n => n.includes('appointment') || n.includes('booking') || n.includes('confirm') || n.includes('remind'));
  const hasPaymentFail  = names.some(n => n.includes('payment') && (n.includes('fail') || n.includes('retry') || n.includes('decline')));
  const hasUnsubscribe  = names.some(n => n.includes('unsub') || n.includes('opt-out') || n.includes('optout'));
  const hasRenewal      = names.some(n => n.includes('renew') || n.includes('re-engage') || n.includes('winback') || n.includes('expire'));
  const hasReview       = names.some(n => n.includes('review') || n.includes('reputation'));

  const generic = workflows.filter(w => /^workflow\s*\d+$/i.test(w.name || ''));

  if (active.length === 0 && workflows.length === 0) {
    issues.push({ severity: 'critical', title: 'No workflows found', detail: 'This account has zero workflows. All lead nurturing, onboarding, and follow-up automation is missing.', fix: 'Create essential workflows: lead nurture, appointment confirmation, onboarding series, and payment receipt.' });
  }
  if (!hasOnboarding) {
    issues.push({ severity: 'critical', title: 'Missing onboarding workflow', detail: 'No onboarding workflow detected. New clients are not being guided through your process automatically.', fix: 'Create a new client onboarding workflow: welcome email, resource delivery, next steps, and check-in sequence.' });
  }
  if (!hasLeadFollowUp) {
    issues.push({ severity: 'critical', title: 'Missing lead follow-up automation', detail: 'No lead follow-up or nurture sequence found. Leads that don\'t convert immediately are being lost.', fix: 'Build an after-intro-call workflow that sends follow-up emails based on whether the lead purchased or not.' });
  }
  if (!hasPaymentFail) {
    issues.push({ severity: 'warning', title: 'No failed payment workflow', detail: 'If a client\'s payment fails, there is no automated recovery process.', fix: 'Create a failed payment workflow: immediate notification email + SMS, retry reminders, and pause access after X days.' });
  }
  if (!hasAppointment) {
    issues.push({ severity: 'critical', title: 'No appointment confirmation workflow', detail: 'No workflow to confirm, remind, or follow up on appointments. This directly causes no-shows.', fix: 'Create appointment automation: confirmation email on booking, 24hr reminder, 1hr SMS reminder, post-appointment follow-up.' });
  }
  if (!hasUnsubscribe) {
    issues.push({ severity: 'warning', title: 'No unsubscribe handling workflow', detail: 'Without an unsubscribe workflow, contact compliance (CAN-SPAM/GDPR) may be at risk.', fix: 'Create an unsubscribe workflow that tags contacts and removes them from active campaigns immediately.' });
  }
  if (!hasRenewal) {
    issues.push({ severity: 'suggestion', title: 'No re-engagement or renewal workflow', detail: 'No workflows detected for re-engaging past clients or renewing subscriptions.', fix: 'Build a renewal reminder workflow 30/14/7 days before expiration, and a win-back sequence for churned clients.' });
  }
  if (!hasReview) {
    issues.push({ severity: 'suggestion', title: 'No review request workflow', detail: 'No automated review or reputation management workflow found.', fix: 'Add a post-service review request workflow that sends via SMS or email 24–48 hours after completion.' });
  }
  if (generic.length > 2) {
    issues.push({ severity: 'warning', title: `${generic.length} workflows have generic names`, detail: 'Workflows named "Workflow 1", "Workflow 2" etc. are impossible to manage at scale.', fix: 'Rename all workflows to clearly describe their trigger and purpose (e.g. "Lead — Post Intro Call Follow-Up").' });
  }
  if (draft.length > 5) {
    issues.push({ severity: 'warning', title: `${draft.length} workflows still in draft`, detail: 'Many workflows are sitting in draft and not active.', fix: 'Review draft workflows — publish the ones that are ready, delete the ones that aren\'t needed.' });
  }

  const critCount = issues.filter(i => i.severity === 'critical').length;
  let score = 100;
  score -= critCount * 20;
  score -= issues.filter(i => i.severity === 'warning').length * 8;
  score -= issues.filter(i => i.severity === 'suggestion').length * 3;
  if (active.length === 0) score = Math.min(score, 10);
  score = Math.max(0, Math.min(100, score));

  const expert = active.length === 0
    ? 'Zero workflows is a critical gap — this account is running entirely manually.'
    : active.length < 5
    ? `Only ${active.length} active workflows is below the threshold for a production account. Key automations are likely missing.`
    : `${active.length} active workflows shows good automation usage. Focus on ensuring the core client journey flows are covered.`;

  return { score, issues, expert, stats: { total: workflows.length, active: active.length, draft: draft.length } };
}

function analyzeContacts(contacts) {
  const issues = [];
  const total = contacts.length;

  if (total === 0) {
    issues.push({ severity: 'warning', title: 'No contacts found', detail: 'No contacts in this account. Either the account is brand new or the wrong Location ID was used.', fix: 'Verify the Location ID is correct and that contacts have been imported or created.' });
    return { score: 50, issues, expert: 'No contacts found — verify this is the correct sub-account.', stats: { total: 0, withEmail: 0, withPhone: 0, withTags: 0 } };
  }

  const withEmail = contacts.filter(c => c.email).length;
  const withPhone = contacts.filter(c => c.phone).length;
  const withTags  = contacts.filter(c => c.tags && c.tags.length > 0).length;
  const emailPct  = Math.round((withEmail / total) * 100);
  const phonePct  = Math.round((withPhone / total) * 100);
  const tagPct    = Math.round((withTags  / total) * 100);

  if (emailPct < 70) issues.push({ severity: 'critical', title: `Only ${emailPct}% of contacts have an email`, detail: 'Low email coverage severely limits your ability to run email campaigns.', fix: 'Run a data enrichment pass or add an email capture step to all intake forms.' });
  if (phonePct < 50) issues.push({ severity: 'warning', title: `Only ${phonePct}% of contacts have a phone number`, detail: 'Low phone coverage limits SMS workflows and call-based follow-ups.', fix: 'Add phone as a required field on all forms and landing pages.' });
  if (tagPct < 40)   issues.push({ severity: 'warning', title: `Only ${tagPct}% of contacts are tagged`, detail: 'Without tags, segmentation and targeted campaigns are not possible.', fix: 'Implement a tagging strategy: tag by lead source, stage, service type, and status.' });

  const score = Math.max(0, 100 - issues.filter(i => i.severity === 'critical').length * 25 - issues.filter(i => i.severity === 'warning').length * 10);
  const expert = `${total} contacts with ${emailPct}% email coverage and ${tagPct}% tagging. ${tagPct < 40 ? 'Tagging hygiene needs attention — without tags, list segmentation is impossible.' : 'Tag coverage is reasonable.'}`;

  return { score, issues, expert, stats: { total, withEmail, withPhone, withTags } };
}

function analyzePipelines(pipelines, opportunities) {
  const issues = [];
  if (pipelines.length === 0) {
    issues.push({ severity: 'critical', title: 'No pipelines configured', detail: 'Without pipelines, there is no structured way to track leads through your sales process.', fix: 'Create at minimum: a Lead/Prospect pipeline and a Client Lifecycle pipeline with stages matching your business process.' });
    return { score: 0, issues, expert: 'Missing pipelines means zero visibility into your sales funnel.', stats: { pipelines: 0, opportunities: 0, stale: 0 } };
  }
  if (pipelines.length === 1) {
    issues.push({ severity: 'warning', title: 'Only one pipeline configured', detail: 'A single pipeline is usually not enough to handle both lead tracking and client lifecycle management.', fix: 'Consider adding a separate Client Lifecycle or Onboarding pipeline to separate pre-sale from post-sale.' });
  }

  const now = Date.now();
  const stale = opportunities.filter(o => {
    if (!o.updatedAt) return false;
    const days = (now - new Date(o.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    return days > 30;
  });

  if (stale.length > 0) {
    issues.push({ severity: 'warning', title: `${stale.length} stale opportunities (30+ days without update)`, detail: 'Opportunities sitting unchanged for over 30 days are likely lost deals clogging your pipeline.', fix: 'Review stale opportunities monthly — close lost deals, re-engage warm ones, delete dead ones.' });
  }

  const noAutomate = pipelines.filter(p => p.name && !['closed', 'won', 'lost'].some(k => p.name.toLowerCase().includes(k)));
  if (noAutomate.length > 0) {
    issues.push({ severity: 'suggestion', title: 'Verify stage-change automations are connected', detail: 'Pipelines are most powerful when workflow automations fire on stage changes.', fix: 'Add workflow triggers for each key pipeline stage: "Opportunity Stage Changed" → relevant automation.' });
  }

  const score = Math.max(0, 100 - issues.filter(i => i.severity === 'critical').length * 40 - issues.filter(i => i.severity === 'warning').length * 15 - issues.filter(i => i.severity === 'suggestion').length * 5);
  const expert = `${pipelines.length} pipeline(s) with ${opportunities.length} total opportunities. ${stale.length > 0 ? `${stale.length} stale opportunities need review.` : 'No stale opportunities detected — good pipeline hygiene.'}`;
  return { score, issues, expert, stats: { pipelines: pipelines.length, opportunities: opportunities.length, stale: stale.length } };
}

function analyzeCalendars(calendars) {
  const issues = [];
  if (calendars.length === 0) {
    issues.push({ severity: 'critical', title: 'No calendars configured', detail: 'No booking calendars are set up. Clients cannot self-book, and appointment workflows have no trigger.', fix: 'Create at minimum: an introductory/discovery call calendar and a main service delivery calendar.' });
    return { score: 0, issues, expert: 'No calendars means clients cannot self-book. This is a critical gap for any service business.', stats: { total: 0, withTeam: 0 } };
  }

  const withTeam = calendars.filter(c => c.teamMembers && c.teamMembers.length > 0).length;
  if (withTeam < calendars.length) {
    issues.push({ severity: 'warning', title: `${calendars.length - withTeam} calendar(s) have no team members assigned`, detail: 'Calendars without team members may not route bookings correctly.', fix: 'Assign at least one team member to every active calendar.' });
  }
  issues.push({ severity: 'suggestion', title: 'Verify appointment reminder automations are connected', detail: 'GHL calendars do not automatically send reminders — you must connect a workflow.', fix: 'Create a workflow triggered by "Appointment Booked" that sends confirmation + 24hr + 1hr SMS/email reminders.' });

  const score = Math.max(0, 100 - issues.filter(i => i.severity === 'critical').length * 40 - issues.filter(i => i.severity === 'warning').length * 15 - issues.filter(i => i.severity === 'suggestion').length * 5);
  const expert = `${calendars.length} calendar(s) configured. ${withTeam < calendars.length ? 'Some calendars lack assigned team members.' : 'All calendars have team members.'} Always verify reminder workflows are active.`;
  return { score, issues, expert, stats: { total: calendars.length, withTeam } };
}

function analyzeForms(forms, surveys) {
  const issues = [];
  const total = forms.length + surveys.length;

  if (total === 0) {
    issues.push({ severity: 'critical', title: 'No forms created', detail: 'No forms or surveys exist. Lead capture, intake, and feedback collection is manual or nonexistent.', fix: 'Create at minimum: an intake/application form, a client onboarding form, and a feedback/NPS form.' });
    return { score: 0, issues, expert: 'No forms means manual data collection — a major efficiency gap.', stats: { forms: 0, surveys: 0 } };
  }
  if (surveys.length === 0) {
    issues.push({ severity: 'suggestion', title: 'No surveys configured', detail: 'Surveys are useful for NPS, feedback collection, and lead qualification.', fix: 'Add at least one feedback survey to collect client satisfaction data post-service.' });
  }
  issues.push({ severity: 'suggestion', title: 'Verify all forms are connected to workflows', detail: 'Forms are only valuable if submissions trigger an automation.', fix: 'For each form, confirm there is a workflow with "Form Submitted" as the trigger.' });

  const score = Math.max(0, 100 - issues.filter(i => i.severity === 'critical').length * 40 - issues.filter(i => i.severity === 'warning').length * 15 - issues.filter(i => i.severity === 'suggestion').length * 5);
  const expert = `${forms.length} form(s) and ${surveys.length} survey(s) found. Always confirm each form has a corresponding workflow trigger — orphaned forms capture data but do nothing with it.`;
  return { score, issues, expert, stats: { forms: forms.length, surveys: surveys.length } };
}

function analyzeSettings(location) {
  const issues = [];
  const emailOk = !!(location.email || location.businessEmail);
  const phoneOk = !!(location.phone);
  const tzOk    = !!(location.timezone);
  const logoOk  = !!(location.logoUrl);
  const addrOk  = !!(location.address);

  if (!emailOk) issues.push({ severity: 'critical', title: 'No sender email address configured', detail: 'All outgoing emails from GHL will use a default address. This severely hurts deliverability and looks unprofessional.', fix: 'Go to Settings → Business Info → Email and add your verified sender email address.' });
  if (!phoneOk) issues.push({ severity: 'critical', title: 'No phone/SMS number configured', detail: 'SMS workflows cannot send messages without a configured phone number. All SMS automation is broken.', fix: 'Go to Settings → Phone Numbers and add or purchase a Twilio/LC Phone number for your location.' });
  if (!tzOk)    issues.push({ severity: 'warning',  title: 'No timezone configured', detail: 'Without a timezone, scheduled sends and appointments may fire at the wrong time.', fix: 'Set the correct timezone under Settings → Business Info.' });
  if (!logoOk)  issues.push({ severity: 'suggestion', title: 'No logo uploaded', detail: 'Missing logo affects branding on emails, funnels, and the client portal.', fix: 'Upload your logo under Settings → Business Info.' });
  if (!addrOk)  issues.push({ severity: 'suggestion', title: 'No business address on file', detail: 'A physical address is legally required in the footer of marketing emails (CAN-SPAM).', fix: 'Add your business address under Settings → Business Info.' });

  const score = Math.max(0, 100 - issues.filter(i => i.severity === 'critical').length * 25 - issues.filter(i => i.severity === 'warning').length * 10 - issues.filter(i => i.severity === 'suggestion').length * 5);
  const expert = `Email configured: ${emailOk ? 'Yes' : 'No ⚠️'}. Phone configured: ${phoneOk ? 'Yes' : 'No ⚠️'}. ${!emailOk || !phoneOk ? 'Missing communication settings will silently break automations.' : 'Core communication channels are set up.'}`;
  return { score, issues, expert, stats: { emailOk, phoneOk, tzOk, logoOk, addrOk } };
}

function analyzeCustomValues(customValues) {
  const issues = [];
  if (customValues.length === 0) {
    issues.push({ severity: 'warning', title: 'No custom values configured', detail: 'Custom values store reusable dynamic content — business name, links, pricing — used across all emails and workflows.', fix: 'Add key custom values: your business name, website URL, booking link, service price, and social media links.' });
  } else if (customValues.length < 5) {
    issues.push({ severity: 'suggestion', title: 'Few custom values — dynamic content in templates is limited', detail: 'A well-built account typically has 10–30 custom values for common business details.', fix: 'Expand your custom values to include booking links, pricing tiers, resource links, and team info.' });
  }

  const knownIntegrations = ['stripe', 'zapier', 'twilio', 'calendly', 'mailchimp', 'activecampaign', 'hubspot'];
  const found = customValues.filter(cv => knownIntegrations.some(k => (cv.name || '').toLowerCase().includes(k)));
  if (found.length === 0 && customValues.length > 0) {
    issues.push({ severity: 'suggestion', title: 'No known integration references in custom values', detail: 'Integrations like Stripe, Zapier, and Twilio are often referenced via custom values.', fix: 'Verify your integrations are connected under Settings → Integrations.' });
  }

  const score = Math.max(0, 100 - issues.filter(i => i.severity === 'warning').length * 15 - issues.filter(i => i.severity === 'suggestion').length * 5);
  const expert = customValues.length === 0
    ? 'No custom values — email personalization is limited to first name only.'
    : `${customValues.length} custom value(s) configured. Custom values are the data infrastructure for dynamic email and SMS content.`;
  return { score, issues, expert, stats: { total: customValues.length } };
}

function buildOverallScore(sections) {
  const scores = Object.values(sections).map(s => s.score);
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function buildAllIssues(sections) {
  return Object.entries(sections).flatMap(([section, data]) =>
    (data.issues || []).map(issue => ({ ...issue, section }))
  ).sort((a, b) => {
    const order = { critical: 0, warning: 1, suggestion: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post('/api/audit', async (req, res) => {
  const { token, locationId } = req.body;
  if (!token || !locationId) return res.status(400).json({ error: 'Token and Location ID are required.' });

  res.setHeader('Content-Type', 'application/json');

  const results = {};
  const errors  = {};

  // 1. Location / Settings
  try {
    const data = await ghlGet(token, `/locations/${locationId}`);
    const loc  = data.location || data;
    results.settings = analyzeSettings(loc);
    results.settings.location = { name: loc.name, email: loc.email || loc.businessEmail, phone: loc.phone, timezone: loc.timezone, logoUrl: loc.logoUrl };
  } catch (e) {
    errors.settings  = e.message;
    results.settings = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch location settings', detail: e.message, fix: 'Check that your token has locations.readonly scope.' }], expert: 'Could not fetch location settings.', stats: {} };
  }

  // 2. Contacts
  try {
    const data     = await ghlGet(token, `/contacts/?locationId=${locationId}&limit=100`);
    const contacts = data.contacts || [];
    results.contacts = analyzeContacts(contacts);
  } catch (e) {
    errors.contacts  = e.message;
    results.contacts = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch contacts', detail: e.message, fix: 'Ensure contacts.readonly scope is enabled.' }], expert: 'API error fetching contacts.', stats: { total: 0 } };
  }

  // 3. Pipelines + Opportunities
  try {
    const pData      = await ghlGet(token, `/opportunities/pipelines/?locationId=${locationId}`);
    const pipelines  = pData.pipelines || [];
    let opportunities = [];
    try {
      const oData  = await ghlGet(token, `/opportunities/search/?location_id=${locationId}&limit=100`);
      opportunities = oData.opportunities || [];
    } catch (_) {}
    results.pipelines = analyzePipelines(pipelines, opportunities);
  } catch (e) {
    errors.pipelines  = e.message;
    results.pipelines = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch pipelines', detail: e.message, fix: 'Ensure opportunities.readonly scope is enabled.' }], expert: 'API error fetching pipelines.', stats: { pipelines: 0, opportunities: 0, stale: 0 } };
  }

  // 4. Workflows
  try {
    const data      = await ghlGet(token, `/workflows/?locationId=${locationId}`);
    const workflows = data.workflows || [];
    results.workflows = analyzeWorkflows(workflows);
  } catch (e) {
    errors.workflows  = e.message;
    results.workflows = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch workflows', detail: e.message, fix: 'Ensure workflows.readonly scope is enabled.' }], expert: 'API error fetching workflows.', stats: { total: 0, active: 0, draft: 0 } };
  }

  // 5. Calendars
  try {
    const data      = await ghlGet(token, `/calendars/?locationId=${locationId}`);
    const calendars = data.calendars || [];
    results.calendars = analyzeCalendars(calendars);
  } catch (e) {
    errors.calendars  = e.message;
    results.calendars = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch calendars', detail: e.message, fix: 'Ensure calendars.readonly scope is enabled.' }], expert: 'API error fetching calendars.', stats: { total: 0, withTeam: 0 } };
  }

  // 6. Forms + Surveys
  try {
    const fData   = await ghlGet(token, `/forms/?locationId=${locationId}&limit=50`);
    const forms   = fData.forms || [];
    let surveys   = [];
    try {
      const sData = await ghlGet(token, `/surveys/?locationId=${locationId}&limit=50`);
      surveys     = sData.surveys || [];
    } catch (_) {}
    results.forms = analyzeForms(forms, surveys);
  } catch (e) {
    errors.forms  = e.message;
    results.forms = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch forms', detail: e.message, fix: 'Ensure forms.readonly scope is enabled.' }], expert: 'API error fetching forms.', stats: { forms: 0, surveys: 0 } };
  }

  // 7. Custom Values
  try {
    const data        = await ghlGet(token, `/locations/${locationId}/customValues`);
    const customValues = data.customValues || [];
    results.customValues = analyzeCustomValues(customValues);
  } catch (e) {
    errors.customValues  = e.message;
    results.customValues = { score: 50, issues: [{ severity: 'suggestion', title: 'Could not fetch custom values', detail: e.message, fix: 'Ensure locations/customValues.readonly scope is enabled.' }], expert: 'Could not fetch custom values — check API scopes.', stats: { total: 0 } };
  }

  // 8. Funnels (scope may not always be available)
  try {
    const data    = await ghlGet(token, `/funnels/?locationId=${locationId}&limit=50`);
    const funnels = data.funnels || [];
    const issues  = [];
    if (funnels.length === 0) {
      issues.push({ severity: 'warning', title: 'No funnels or websites found', detail: 'No funnels or websites are set up. Lead capture requires at minimum a landing page and a thank-you page.', fix: 'Build a lead capture funnel: opt-in page → thank you page → trigger a nurture workflow.' });
    } else {
      const unpublished = funnels.filter(f => f.type === 'funnel' && !f.domainConfig);
      if (unpublished.length > 0) {
        issues.push({ severity: 'warning', title: `${unpublished.length} funnel(s) may not have a custom domain`, detail: 'Funnels without a custom domain use the default GHL URL which looks unprofessional.', fix: 'Connect a custom domain to each active funnel under Funnels → Settings → Domain.' });
      }
    }
    const score  = funnels.length === 0 ? 30 : Math.max(50, 100 - issues.filter(i => i.severity === 'warning').length * 15);
    const expert = funnels.length === 0 ? 'No funnels found — every service business needs at minimum a lead capture page and a booking page.' : `${funnels.length} funnel/website(s) found. Verify each is on a custom domain and has a connected automation.`;
    results.funnels = { score, issues, expert, stats: { total: funnels.length } };
  } catch (e) {
    errors.funnels  = e.message;
    results.funnels = { score: 50, issues: [{ severity: 'warning', title: 'Funnels scope needed', detail: e.message, fix: 'Add funnels/funnel.readonly scope to your integration token.' }], expert: 'Funnels are your lead capture front door. Every service business needs at minimum: a lead magnet/opt-in page, a booking page, and a thank-you/confirmation page with proper workflow triggers.', stats: { total: 0 } };
  }

  const overallScore = buildOverallScore(results);
  const allIssues    = buildAllIssues(results);

  res.json({ overallScore, sections: results, allIssues, errors });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ GHL Expert Audit running → http://localhost:${PORT}`));
