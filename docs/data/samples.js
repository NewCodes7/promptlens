// Illustrative sample flows for professions beyond software. Hand-written to show where PromptLens goes next;
// they are NOT captured from real sessions (the Developer flow is — see data/developer.js).
window.PROMPTLENS_SAMPLES = [
  {
    id: "designer",
    profession: "Designer",
    emoji: "🎨",
    author: { name: "Mina", role: "Product designer · freelance" },
    title: "Redesigning a neighborhood bakery's mobile checkout",
    goal: "Cut checkout drop-off for a bakery whose regulars are mostly 60+.",
    deliverable: "Wireframe → usability script → dev handoff",
    turns: [
      {
        title: "Find checkout patterns that reduce drop-off",
        prompts: ["Here are screenshots of three competitor checkouts. Which patterns reduce mobile drop-off, and which ones would I be copying blindly?"],
        steps: [
          { type: "research", text: "Compared the three flows step by step" },
          { type: "plan", text: "Ranked six patterns by expected impact and effort" },
        ],
        outcome: "Six patterns ranked; guest checkout and a single page came out on top.",
        decisions: [{ text: "Start from guest checkout", why: "Account creation was the biggest exit point in all three references." }],
        tips: {
          keep: ["Gave real references instead of asking for 'best practices' in the abstract."],
          improve: ["Say who the customers are (mostly 60+) up front; the first ranking assumed young, fast users."],
        },
        metrics: { minutes: 9, aiSteps: 4, files: 3 },
        artifacts: ["patterns.md"],
      },
      {
        title: "Draft a one-page checkout wireframe",
        prompts: ["Draft a one-page checkout wireframe: guest checkout first, pickup time picker, Apple Pay at the top. Describe each section so I can rebuild it in Figma."],
        steps: [
          { type: "create", text: "Laid out four sections with copy and field order" },
          { type: "check", text: "Counted taps from cart to paid: 7" },
        ],
        outcome: "Wireframe v1 with four sections and a 7-tap path.",
        decisions: [{ text: "Pickup time before payment", why: "Customers abandon when their slot is gone after paying." }],
        tips: {
          keep: ["Listed hard requirements (guest first, wallet on top) in one sentence."],
          improve: ["Ask for a tap-count target, e.g. 'under 6 taps', so the AI optimizes for it."],
        },
        metrics: { minutes: 14, aiSteps: 5, files: 1 },
        artifacts: ["wireframe-v1"],
      },
      {
        title: "Fix readability for older customers",
        prompts: ["Most customers are over 60. The text is too small and the coupon field distracts. Revise it."],
        steps: [
          { type: "revise", text: "Raised base type to 18px and enlarged touch targets to 48px" },
          { type: "check", text: "Checked color contrast against WCAG AA" },
          { type: "revise", text: "Collapsed the coupon field behind a text link" },
        ],
        outcome: "Wireframe v2 passes WCAG AA contrast; coupon no longer competes with Pay.",
        decisions: [{ text: "Collapse the coupon field instead of removing it", why: "Regulars use paper coupons at the counter; online codes are rare." }],
        tips: {
          keep: ["Explained the reason (age) rather than only the symptom (small text)."],
          improve: ["Name the accessibility standard you need (WCAG AA) — the AI only checked it because it guessed."],
        },
        metrics: { minutes: 11, aiSteps: 6, files: 1 },
        artifacts: ["wireframe-v2"],
      },
      {
        title: "Write a usability test script",
        prompts: ["Write five usability test tasks for this flow that I can run with three regulars at the bakery. No leading questions."],
        steps: [
          { type: "create", text: "Wrote five tasks with success criteria" },
          { type: "revise", text: "Reworded two tasks that hinted at the answer" },
        ],
        outcome: "A 15-minute test script with five tasks and pass/fail criteria.",
        decisions: [],
        tips: {
          keep: ["Gave the real test setting (three regulars, in person)."],
          improve: ["Ask for a short observer note sheet too; it saves a step after the test."],
        },
        metrics: { minutes: 7, aiSteps: 3, files: 1 },
        artifacts: ["test-script.md"],
      },
    ],
    learn: {
      gaps: ["WCAG AA contrast and minimum touch-target sizes", "How to write non-leading usability tasks"],
      patterns: ["Give references, not adjectives", "State the audience before asking for a design"],
    },
    comments: [
      { name: "Jae", role: "Frontend developer", text: "Tap-count target is a great idea. I'd add it to my UI tickets too." },
      { name: "Sora", role: "UX researcher", text: "For 60+ users, also ask the AI about motion and timeouts — session timeouts on payment pages hurt them most." },
    ],
  },
  {
    id: "marketer",
    profession: "Marketer",
    emoji: "📣",
    author: { name: "Daniel", role: "Growth marketer · D2C brand" },
    title: "Launch email for a reusable water bottle",
    goal: "Write a launch email that sells a $35 bottle without sounding like every other eco brand.",
    deliverable: "Segments → subject lines → email → A/B plan",
    turns: [
      {
        title: "Define who buys a $35 bottle",
        prompts: ["Who actually buys a $35 reusable bottle? Give me three segments with their real pains, not demographics."],
        steps: [
          { type: "research", text: "Drafted three segments from purchase motives" },
          { type: "plan", text: "Picked commuters as the launch segment" },
        ],
        outcome: "Three segments; commuters chosen for the launch.",
        decisions: [{ text: "Target commuters first", why: "Clearest daily pain (leaks in bags) and highest repeat use." }],
        tips: {
          keep: ["Asked for pains, not demographics."],
          improve: ["Share your existing customer data (even 20 reviews) so segments come from evidence, not guesses."],
        },
        metrics: { minutes: 6, aiSteps: 3, files: 0 },
        artifacts: ["segments.md"],
      },
      {
        title: "Write subject lines for commuters",
        prompts: ["Write 10 subject lines for commuters, under 45 characters."],
        steps: [{ type: "create", text: "Wrote ten subject lines" }],
        outcome: "Ten options, but most read like generic promo copy.",
        decisions: [],
        tips: {
          keep: ["Gave a hard length limit that matches mobile inboxes."],
          improve: ["Include your brand voice and a past email that worked — without them the AI writes average copy."],
        },
        metrics: { minutes: 3, aiSteps: 1, files: 0 },
        artifacts: [],
      },
      {
        title: "Match the brand's calm, dry voice",
        prompts: ["Too salesy. Our voice is calm with dry humor. Here are two past emails with 40%+ open rates — match them."],
        steps: [
          { type: "research", text: "Extracted voice rules from the two emails" },
          { type: "revise", text: "Rewrote subject lines and the email body" },
        ],
        outcome: "Email v2 in the brand voice; three subject lines shortlisted.",
        decisions: [{ text: "Lead with the leak-proof lid, not sustainability", why: "Commuters care about bags staying dry; eco claims are expected, not distinctive." }],
        tips: {
          keep: ["Showed examples of what good looks like, with a metric."],
          improve: ["This should have been the first prompt — it saved two rounds once added."],
        },
        metrics: { minutes: 12, aiSteps: 4, files: 2 },
        artifacts: ["email-v2"],
      },
      {
        title: "Check claims that need proof",
        prompts: ["Which claims in this email could get us in trouble? We have no third-party eco certification."],
        steps: [
          { type: "check", text: "Flagged 'eco-friendly' and 'plastic-free' as unsupported" },
          { type: "revise", text: "Replaced them with specific, provable facts" },
        ],
        outcome: "Two risky green claims removed; replaced with material facts.",
        decisions: [{ text: "Say 'stainless steel, no plastic in contact with water'", why: "Specific and verifiable, unlike a vague 'eco-friendly'." }],
        tips: {
          keep: ["Gave the constraint (no certification) instead of asking 'is this okay?'."],
          improve: ["Ask which country's advertising rules apply; green-claim rules differ between the US, EU and Korea."],
        },
        metrics: { minutes: 8, aiSteps: 3, files: 1 },
        artifacts: ["email-v3"],
      },
      {
        title: "Plan the A/B test",
        prompts: ["Design an A/B test for the top two subject lines. List size is 18,000."],
        steps: [
          { type: "plan", text: "Split 20/20 test, 60% winner send" },
          { type: "deliver", text: "Wrote the test plan with a stop rule" },
        ],
        outcome: "Test plan ready with sample sizes and a 4-hour decision rule.",
        decisions: [],
        tips: { keep: ["Gave the list size so the AI could size the test."], improve: [] },
        metrics: { minutes: 5, aiSteps: 2, files: 1 },
        artifacts: ["ab-plan.md"],
      },
    ],
    learn: {
      gaps: ["Green-claim advertising rules", "Sizing an email A/B test"],
      patterns: ["Show a past winner before asking for copy", "Give constraints, not 'is this okay?'"],
    },
    comments: [
      { name: "Mina", role: "Product designer", text: "Turn ③ is the same lesson as my design flow: show references first." },
      { name: "Hyun", role: "In-house lawyer", text: "Good catch on green claims. 'Plastic-free' is one of the most common complaints regulators get." },
    ],
  },
  {
    id: "professional",
    profession: "Professional",
    emoji: "⚖️",
    author: { name: "Hyun", role: "Corporate lawyer" },
    title: "Reviewing a SaaS vendor contract for a client",
    goal: "Turn a 14-page vendor contract into redlines and a plain-language memo by end of day.",
    deliverable: "Clause summary → redlines → client memo",
    note: "The lawyer reviewed every AI output; this flow shows how the work was done, not legal advice.",
    turns: [
      {
        title: "Summarize the contract and flag unusual clauses",
        prompts: ["Summarize this 14-page MSA clause by clause and flag anything unusual compared to typical SaaS contracts."],
        steps: [
          { type: "research", text: "Summarized 23 clauses" },
          { type: "check", text: "Flagged 4 clauses as unusual" },
        ],
        outcome: "Clause map with four flags: liability cap, auto-renewal, data deletion, audit rights.",
        decisions: [],
        tips: {
          keep: ["Asked for a comparison baseline ('typical SaaS'), not just a summary."],
          improve: ["State the governing law and which side you represent; 'unusual' depends on both."],
        },
        metrics: { minutes: 10, aiSteps: 3, files: 1 },
        artifacts: ["clause-map"],
      },
      {
        title: "Test the liability cap against the market",
        prompts: ["We represent the customer, Korean law governs. Liability is capped at 3 months of fees. How far off market is that, and what's a realistic ask?"],
        steps: [
          { type: "research", text: "Compared common cap ranges for customer-side SaaS deals" },
          { type: "plan", text: "Proposed a 12-month cap with a data-breach carve-out" },
        ],
        outcome: "Ask set at 12 months of fees, uncapped for data breaches.",
        decisions: [{ text: "Carve out data breaches from the cap", why: "The client stores customer personal data in this tool." }],
        tips: {
          keep: ["Added side and governing law — the answer became specific."],
          improve: ["Ask the AI to separate what it knows from what you must verify in current case law."],
        },
        metrics: { minutes: 8, aiSteps: 3, files: 0 },
        artifacts: [],
      },
      {
        title: "Draft redlines and check them against the playbook",
        prompts: ["Draft redlines for the four flagged clauses, then check them against our client's negotiation playbook (pasted below)."],
        steps: [
          { type: "create", text: "Drafted redlines for four clauses" },
          { type: "check", text: "Found two conflicts with the client playbook" },
          { type: "revise", text: "Softened the audit-rights ask to match the playbook" },
        ],
        outcome: "Redlines v2 consistent with the client playbook.",
        decisions: [{ text: "Follow the playbook over the 'market' ask on audits", why: "The client already accepted annual audits with other vendors." }],
        tips: {
          keep: ["Pasted the client's own rules so the AI checked against them, not generic norms."],
          improve: [],
        },
        metrics: { minutes: 18, aiSteps: 6, files: 2 },
        artifacts: ["redlines-v2.docx"],
      },
      {
        title: "Write a memo the client can read in 2 minutes",
        prompts: ["Write a one-page memo for the client's CEO: what changes, why it matters, what we give up. No legal jargon."],
        steps: [{ type: "deliver", text: "Wrote a one-page memo with a three-row risk table" }],
        outcome: "Memo sent with the redlines.",
        decisions: [],
        tips: {
          keep: ["Named the reader (CEO) and the time budget."],
          improve: ["Ask for the 'what we give up' section first — executives read the trade-offs before the wins."],
        },
        metrics: { minutes: 6, aiSteps: 2, files: 1 },
        artifacts: ["client-memo.pdf"],
      },
    ],
    learn: {
      gaps: ["Market ranges for SaaS liability caps", "Writing trade-offs for executive readers"],
      patterns: ["Say which side you're on", "Check AI output against your own rules, pasted in"],
    },
    comments: [
      { name: "Ara", role: "Founder", text: "As the CEO reading these memos: yes, trade-offs first please." },
      { name: "Daniel", role: "Growth marketer", text: "'Separate what you know from what I must verify' — stealing this for market research prompts." },
    ],
  },
  {
    id: "founder",
    profession: "Founder",
    emoji: "🚀",
    author: { name: "Ara", role: "First-time founder" },
    title: "Validating a meal-prep subscription for college students",
    goal: "Decide in one week whether a student meal-prep subscription is worth building.",
    deliverable: "Market estimate → interview guide → unit economics → one-pager",
    turns: [
      {
        title: "Estimate the market with visible assumptions",
        prompts: ["Estimate how many college students in Seoul would pay for weekly meal prep. Show every assumption so I can challenge it."],
        steps: [
          { type: "research", text: "Built a bottom-up estimate in five steps" },
          { type: "check", text: "Marked the two weakest assumptions" },
        ],
        outcome: "Rough estimate of 25k–60k students; willingness to pay is the weakest assumption.",
        decisions: [{ text: "Test willingness to pay before anything else", why: "It moves the estimate more than any other input." }],
        tips: {
          keep: ["Asked for assumptions to be shown, so the number can be argued with."],
          improve: ["Give a decision threshold ('worth it above N customers') so the AI tells you whether you've crossed it."],
        },
        metrics: { minutes: 12, aiSteps: 4, files: 1 },
        artifacts: ["market.xlsx"],
      },
      {
        title: "Write interview questions that don't lead",
        prompts: ["Write 10 interview questions for students. I'm worried I'll just hear what I want to hear."],
        steps: [
          { type: "create", text: "Wrote ten questions about past behavior, not opinions" },
          { type: "revise", text: "Removed three questions that pitched the idea" },
        ],
        outcome: "Interview guide focused on what students did last week, not what they'd buy.",
        decisions: [],
        tips: {
          keep: ["Told the AI your actual fear (confirmation bias)."],
          improve: ["Ask it to teach the principle behind the questions (past behavior over hypotheticals) so you can improvise live."],
        },
        metrics: { minutes: 7, aiSteps: 3, files: 1 },
        artifacts: ["interview-guide.md"],
      },
      {
        title: "Model unit economics at ₩8,900 per meal",
        prompts: ["Build unit economics for ₩8,900 per meal, 5 meals a week."],
        steps: [
          { type: "create", text: "Built a per-meal and per-customer model" },
          { type: "check", text: "Flagged that customer acquisition cost was missing" },
        ],
        outcome: "Gross margin 31%; payback unknown until acquisition cost is estimated.",
        decisions: [],
        tips: {
          keep: ["Gave concrete price and frequency."],
          improve: ["Include acquisition channel and cost guesses — margin without CAC can't answer 'is this a business?'."],
        },
        metrics: { minutes: 9, aiSteps: 3, files: 1 },
        artifacts: ["unit-economics.xlsx"],
      },
      {
        title: "Pivot after 12 interviews",
        prompts: ["12 interviews done (notes pasted). Students want flexibility more than a lower price. What should change?"],
        steps: [
          { type: "research", text: "Clustered interview notes into four themes" },
          { type: "plan", text: "Proposed pay-per-meal credits instead of weekly plans" },
          { type: "revise", text: "Re-ran unit economics for credits" },
        ],
        outcome: "Switched to meal credits; margin holds at 28% with lower churn risk.",
        decisions: [{ text: "Sell meal credits, not weekly subscriptions", why: "9 of 12 students skipped meals during exam weeks and hated paying for them." }],
        tips: {
          keep: ["Pasted raw notes instead of your own summary — the AI found a theme you missed."],
          improve: [],
        },
        metrics: { minutes: 15, aiSteps: 6, files: 2 },
        artifacts: ["one-pager.pdf"],
      },
    ],
    learn: {
      gaps: ["Customer interview technique (past behavior over hypotheticals)", "Why CAC decides unit economics"],
      patterns: ["Ask the AI to show its assumptions", "Paste raw evidence, not your summary"],
    },
    comments: [
      { name: "Jae", role: "Frontend developer", text: "Turn ④ is basically 'paste the logs, not your interpretation' — same as debugging." },
      { name: "Hyun", role: "Corporate lawyer", text: "Before selling credits, check prepaid-credit refund rules. Ask the AI about that next." },
    ],
  },
];

// The real Developer flow (from GitHub) gets the same page furniture; only these extras are hand-written.
window.PROMPTLENS_DEV_EXTRAS = {
  author: { name: "NewCodes7", role: "Developer · hackathon build" },
  title: "Building PromptLens itself with Claude Code",
  goal: "Ship a CLI that turns AI coding sessions into a reviewable PR report — in one morning.",
  deliverable: "CLI → git notes → PR comment",
  // English translations of the Korean prompts, by turn index (written for this page; the originals are shown verbatim).
  translations: {
    0: "Implement this as planned in the Notion doc — ideally done by 1 pm. Before building, survey me on anything ambiguous or worth deciding up front.",
    1: "1. Logged in to the claude CLI  2. Registered the OpenAI key",
    2: "Did the workflow work?  →  Yes, fix it",
    3: "The PR result is a bit underwhelming… Any way to show the prompting process more vividly? We can't make a PR comment interactive — it's markdown. We don't know how many sessions there are or how long each one runs. For now, are commits being recorded properly?",
    4: "Conversations can get very long, but summarizing them into categories and showing a flow of chunks keeps the length predictable — if it's too long, make the categories coarser. Show which flow of prompt chunks built this PR. Let's flesh this out; feel free to ask me more.",
    6: "Group by the user's prompt, not by the agent's actions: if one prompt led to build, fix and more, show it as one chunk — summarize what the AI did for each prompt. Ask me about unclear UI details, and borrow ideas from real services that summarize AI work.",
  },
  learn: {
    gaps: ["Which secrets CI needs before you design the pipeline", "How GitHub renders Mermaid inside PR comments"],
    patterns: ["Ask the AI to survey you before it builds", "A hard deadline makes the AI cut scope for you"],
  },
  comments: [
    { name: "Ara", role: "Founder", text: "'Survey me before you build' works for business plans too. I used it on my pitch deck this week." },
    { name: "Mina", role: "Product designer", text: "Turn ⑤ → ⑦ is exactly how design critique goes: first the shape, then 'no, group it by what the user asked for'." },
  ],
};
