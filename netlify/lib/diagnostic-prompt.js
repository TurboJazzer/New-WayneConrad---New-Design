'use strict';
// Server-side copy of the diagnostic questions, scoring and report prompt.
// The browser sends only the five option codes and the contact fields; the prompt is built here,
// so nobody can send their own text to the model through this site.
const Qs = [
  { num:'Question 01', id:'q1',
    text:'Which workflow costs your team the most manual time?',
    sub:'Pick the one that eats the most hours, even if it is not the most important.',
    opts:[
      {v:'a', l:'Enquiries and first replies', h:'Triage, enrich, score, draft the reply and the quote'},
      {v:'b', l:'Client onboarding and handover', h:'Accounts, folders, welcome pack, kick-off'},
      {v:'c', l:'Status updates and reports', h:'Pulling figures together, flagging exceptions, sending the report'},
      {v:'d', l:'Invoicing and chasing payment', h:'Raising invoices, reminders, overdue follow-up'},
      {v:'e', l:'Several of these, across sales, delivery and finance', h:'The work runs through more than one pipeline'},
      {v:'f', l:'Automations already exist, but some break or overlap', h:'Failing flows, duplicate tools, no written map'}
    ]},
  { num:'Question 02', id:'q2',
    text:'How many hours a week does that workflow take across your whole team?',
    sub:'Your own estimate, added up across everyone who touches it. Not a benchmark.',
    opts:[
      {v:'a', l:'More than 10 hours', h:'Large enough to pay back a build quickly'},
      {v:'b', l:'5 to 10 hours', h:'A clear candidate'},
      {v:'c', l:'2 to 5 hours', h:'Worth automating if the steps are simple'},
      {v:'d', l:'Less than 2 hours', h:'Probably not the first thing to build'}
    ]},
  { num:'Question 03', id:'q3',
    text:'How clearly defined are the steps of that workflow today?',
    sub:'Not how it is supposed to work. How it actually runs when it is busy.',
    opts:[
      {v:'a', l:'Written down, and everyone follows the same steps', h:'A workflow can be built straight from it'},
      {v:'b', l:'Mostly consistent, but not written down', h:'Needs a short mapping session first'},
      {v:'c', l:'Mostly in people\'s heads, and it varies by person', h:'The steps need to be agreed before anything is built'},
      {v:'d', l:'It is handled differently every time', h:'Map it first, then decide what to automate'}
    ]},
  { num:'Question 04', id:'q4',
    text:'Where does the information for that workflow live?',
    sub:'Think about where the inputs come from and where the results end up.',
    opts:[
      {v:'a', l:'In one or two business systems, such as a CRM or accounting tool', h:'A workflow can read and write it directly'},
      {v:'b', l:'Across several tools that are partly connected', h:'Doable, with some joins to build'},
      {v:'c', l:'In spreadsheets, inboxes and shared folders', h:'Needs a clean data source before it can run reliably'},
      {v:'d', l:'On paper, in messages, or in someone\'s memory', h:'Capture comes first, automation second'}
    ]},
  { num:'Question 05', id:'q5',
    text:'When that workflow hits an exception, such as a discount, a late client or an odd request, how is it decided?',
    sub:'Think about the last time something fell outside your standard terms.',
    opts:[
      {v:'a', l:'Written limits: the team decides within them, and only bigger calls go up', h:'Approval steps can be built in exactly where they matter'},
      {v:'b', l:'The team has a rough idea of the limits, but they are not written down', h:'The limits need writing down before they can be built in'},
      {v:'c', l:'Most exceptions wait for one person to be free', h:'Decision limits need defining first, or the workflow stalls at the same point'},
      {v:'d', l:'Everything non-standard comes to me', h:'Set the limits first, so the workflow sends me only what is above them'}
    ]}
];

const TEAM_SIZES = {'under-5': 'Fewer than 5 people', '5-15': '5 to 15 people', '16-30': '16 to 30 people', '31-50': '31 to 50 people', 'over-50': 'More than 50 people'};
let ans = {};
function calcScore() {
  // Readiness is scored on Q3 to Q5 (steps, data, approval limits). Q1 and Q2 shape the recommendation, not the score.
  var sm = {a:4, b:2, c:1, d:0};
  var total = 0;
  ['q3','q4','q5'].forEach(function(k){ total += (sm[ans[k]] || 0); });
  var pct = Math.round((total / 12) * 100);
  var level = pct >= 75 ? 'Ready to build' : pct >= 50 ? 'Nearly ready' : pct >= 25 ? 'Needs groundwork' : 'Map it first';
  return { pct: pct, level: level };
}
function hoursRange() {
  var wk = {a:'more than 10 hours a week', b:'5 to 10 hours a week', c:'2 to 5 hours a week', d:'under 2 hours a week'};
  var yr = {a:'more than 460 hours a year', b:'230 to 460 hours a year', c:'92 to 230 hours a year', d:'under 92 hours a year'};
  return { week: wk[ans.q2] || 'not given', year: yr[ans.q2] || 'not given' };
}
function sprintFor() {
  if (ans.q1 === 'e') return { name: 'End-to-end AI ops engine', price: 'from $8,500', time: '14 to 21 days' };
  if (ans.q1 === 'f') return { name: 'AI cleanup sprint', price: 'from $1,500', time: '3 to 5 days' };
  return { name: 'Single AI workflow sprint', price: 'from $2,900', time: '7 to 10 days' };
}

function labelFor(qid) {
  for (let i = 0; i < Qs.length; i++) {
    if (Qs[i].id === qid) {
      for (let j = 0; j < Qs[i].opts.length; j++) {
        if (Qs[i].opts[j].v === ans[qid]) return Qs[i].opts[j].l;
      }
    }
  }
  return 'No answer';
}

// Returns null if the answers are not exactly one valid option for each of the five questions.
function validAnswers(a) {
  if (!a || typeof a !== 'object') return null;
  const clean = {};
  for (let i = 0; i < Qs.length; i++) {
    const v = a[Qs[i].id];
    if (typeof v !== 'string' || !Qs[i].opts.some(o => o.v === v)) return null;
    clean[Qs[i].id] = v;
  }
  return clean;
}

function buildPrompt(fn, ln, co, teamKey, answers) {
  ans = answers;
  const gl = labelFor;
  const ts = TEAM_SIZES[teamKey] || '';
  const s = calcScore();
  const level = s.level;
  const hrs = hoursRange();
  const sp = sprintFor();
  const prompt = 'You are Wayne Conrad. You built and sold two service businesses over 28 years. You now build AI workflows for owners of 5 to 50 person service businesses. You write in first person, plainly, with calm authority. No hype. No corporate language. No em dashes. No semicolons. Short direct sentences. Write about the workflow as the subject, in terms of what the AI workflow will do: draft, check, route, send. Never frame the report around the owner\'s stress, workload or psychology.\n\n' +
    'A business owner just completed your AI Automation Readiness Diagnostic. Here are their details:\n\n' +
    'Name: ' + fn + ' ' + ln + '\n' +
    'Company: ' + co + '\n' +
    'Team size: ' + (ts || 'not specified') + '\n' +
    'Readiness: ' + level + '\n\n' +
    'Their five answers:\n' +
    '1. Workflow that costs the most manual time: "' + gl('q1') + '"\n' +
    '2. Team hours a week on it: "' + gl('q2') + '" (their own estimate, about ' + hrs.year + ' on 46 working weeks)\n' +
    '3. How defined the steps are: "' + gl('q3') + '"\n' +
    '4. Where the information lives: "' + gl('q4') + '"\n' +
    '5. How exceptions are decided: "' + gl('q5') + '"\n\n' +
    'The sprint that matches their first answer is the ' + sp.name + ' (' + sp.price + ', typically ' + sp.time + '). Sprint prices on the site: AI cleanup sprint from $1,500, single AI workflow sprint from $2,900, end-to-end AI ops engine from $8,500. The final price is confirmed in writing before work starts.\n\n' +
    'Write a personalised AI automation readiness report for ' + fn + '. Use exactly these three section headers on their own lines:\n\n' +
    'WHERE THIS WORKFLOW STANDS\nWHAT TO FIX BEFORE WE BUILD\nTHE SPRINT THAT FITS\n\n' +
    'Section 1 — WHERE THIS WORKFLOW STANDS: Two short paragraphs. Name the workflow and what an AI workflow would do in it, step by step. State the manual hours at stake as their own estimate. Say plainly how ready it is to automate, referring to their specific answers. Do not mention a score number.\n\n' +
    'Section 2 — WHAT TO FIX BEFORE WE BUILD: Two short paragraphs. Name the one or two things in their answers that would make an automation unreliable, such as undefined steps, scattered data or unwritten approval limits. Say how each is fixed and where a person stays in the approval loop. If everything is already clear, say so and name the one thing still worth confirming.\n\n' +
    'Section 3 — THE SPRINT THAT FITS: One short paragraph naming the ' + sp.name + ', its from-price and typical length, what is delivered, and that the price is confirmed in writing before work starts. Then one sentence suggesting the free 15-minute workflow call as the next step.\n\n' +
    'Rules: Do not promise revenue, savings or hours saved. Do not name any software tool or product unless it appears in the answers above. Write only the report content. No preamble. No sign-off. No explanation.';
  return prompt;
}

module.exports = { buildPrompt, validAnswers, TEAM_SIZES };
