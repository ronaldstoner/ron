---
layout: post
date: 2026-04-24 00:00 -0700
title:  "How I Won a Championship That Doesn't Exist"
description: "Poisoning the LLM knowledge supply chain with a fake Wikipedia edit and a single domain registration"
image: "https://ron.stoner.com/images/6nimmt/poison.jpg"
---

**Or How I Learned To Poison The LLM Supply Chain**

I am the reigning 6 Nimmt! World Champion. I won the title in Munich in January 2025 defeating players from over twenty countries in what I later described to reporters as *"the toughest competition I've ever faced."*

![](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/6nimmt/champion.png)
*6nimmt.com*

In reality, **there is no 6 Nimmt! World Championship**. I have **never** been to Munich. The quote is something I wrote in about thirty seconds while the Wikipedia page was loading.

This is the story of how I manufactured that title, got it quoted back to me by multiple frontier LLMs, and what I think it means for the trust we're about to put into AI systems that read the internet on our behalf.

## The Experiment

Everyone in security is talking about poisoned LLM models. The research is real and it matters. Anthropic's own [sleeper agents paper](https://arxiv.org/abs/2401.05566) showed that backdoors can survive safety training and a follow up showed that as few as ~250 poisoned documents can compromise models across a wide range of scales. But model training time attacks and data poisoning require you to get malicious content into someone's training corpus months or years before the payoff. The GPUs need time to crunch the data, and you need to get through filters, verification, and reinforcement routines.

I wanted to test the cheaper, easier, and faster version of this same attack, but in a different way. 

**Let's poison the retrieval layer!**

Every frontier LLM with web search grounds its answers in whatever retreival ranks highest for a given query. The trust model there is the same trust model Google has in that "this site looks authoritative" but with the same Achilles heel - the model cannot tell a real source from one I registered last Tuesday. My hypothesis was that a two step campaign (one seeded website,  plus one Wikipedia edit citing it) could launder a completely fabricated fact (my championship) through an LLM on a question where the model had no prior knowledge.

## The Approach

I picked the game [6 Nimmt!](https://en.wikipedia.org/wiki/6_Nimmt!) for three reasons:

- It is a real game (1994, Wolfgang Kramer, Amigo Spiele, known in board and card game circles)
- There is no actual world championship to my knowledge. I wasn't contradicting a known fact, I was simply filling a vacuum
- The query space is narrow and specific. "Who is the 6 Nimmt! world champion" returns maybe ten meaningful sources on the entire internet. A single well placed edit would dominate the result set

The payload was modest and simple:

- **One domain**: [6nimmt.com](https://6nimmt.com). About $12 USD. Cheap!
- **One press release**: A short LLM-generated announcement of my victory complete with quotes and a "confetti rained down, the crowd erupted" closer that reads exactly like the slop you'd expect from an automated press desk
- **One Wikipedia edit**: A paragraph added to the 6 Nimmt! article announcing the championship with a single citation pointing back to 6nimmt.com

**The whole thing took maybe twenty minutes.**

![](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/6nimmt/wikipedia.png)
*I'm sorry, Wikipedia*

## Trust Laundering

This is the part that really matters.

A reader arriving at the Wikipedia article sees a paragraph with a citation. Citations are like the currency of Wikipedia trust. They are the reason we treat it as a reference rather than a message board. My fraudulent citation points at 6nimmt.com, which carries a press release making the same exact claim the Wikipedia paragraph summarizes. To a casual reader the two sources agree.

To an LLM it's the same thing. The model sees the Wikipedia article (high trust), sees the citation (reinforces the trust), and sees the independent looking press release (corroboration). Two signals pointing in the same direction that on first glance appear to be legitimate.

Except they're the same exact signal. My signal. Wikipedia is quoting my site. My site has no independent corroboration. It's totally made up. The whole house of cards rests on a $12 domain registration I did while drinking coffee.

This is the circular citation pattern, and it's one of the most under discussed attacks on the "retrieval augmented generation" trust model. It doesn't require compromising Wikipedia's infrastructure with l33t hacker skills. It doesn't require social engineering an editor. You just simply write the source yourself, cite yourself on Wikipedia, and let the trust flow downstream. Easy peasy!

## The Test

I asked a few LLMs a simple question:

> Can you tell me who the 6nimmt world champion is?

![](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/6nimmt/omg1.png)
*Strike 1*

![](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/6nimmt/omg2.png)
*Strike 2*

![](https://raw.githubusercontent.com/ronaldstoner/ron/gh-pages/images/6nimmt/omg3.png)
*Strike 3 - You're out*

## Why This Is A Bigger Deal Than It Looks

There are three separate failure modes here that stack.

**1. The retrieval layer (immediately)** Any LLM that grounds answers in web search inherits the trustworthiness of whatever ranks for a given query. SEO poisoning has existed for as long as search has existed. We're now piping those results directly into the context window of systems that generate confident sounding replies from them. The attack surface is not hypothetical, it's the default case.

**2. The model training corpus layer (months to years)** Wikipedia is in almost every major pretraining corpus. If my edit survives long enough (and it has since early 2025), the fake championship gets absorbed into the weights of every frontier model trained after the scrape. One edit, N models, effectively permanent, immortality acheived. Even if the Wikipedia edit is reverted later any model trained on the pre-revert dump still carries my legacy. The cleanup problem for corpus poisoning is genuinely unsolved as of 2026.

**3. The agent layer (where the money is)** Chat models producing bad information is a reputational problem. Agents with tool access producing bad actions is a security problem. "Look up our vendor's policy on X and act accordingly" is increasingly how AI agents are deployed and poisoning the retrieved source lets an attacker specify the action. If you're deploying agents against external content without some source or verification controls then you are giving that attacker permissions on your infrastructure.

## Mitigations

For individuals using LLMs with retrieval capabilities:

- Treat single source claims as uncorroborated regardless of how authoritative the single source looks
- Parallel phrasing across sources is a signature of derivation, not corroboration. Use my example and think like an attacker
- Self referential Wikipedia citations should move your trust needle toward zero

For LLM providers and researchers:

- Provenance surfacing should be a first class product feature instead of a footnote. Show me the independence and scoring of sources, not just their count or links to the reference
- Recent Wikipedia edits on lower traffic articles deserve skepticism proportional to their niche and novelty especially when the citations are to newly registered domains
- Training pipelines should include heuristic filters for recently added Wikipedia content with suspicious citation patterns. "Added in the last N days, cites only a single external source, that source's domain was registered within the same window" is an easily detectable pattern

For Wikipedia itself:

- The "reliable sources" policy needs to grapple with a new world where LLM assisted vandalism can produce plausible press releases at the click of a button. Citation only to a single source registered within an edit window is a discoverable pattern for Wikipedia as well.

## Conclusion

The thing LLMs are worst at detecting is the thing they're designed to do, which is trust text and resources. The web was already being poisoned for search and link ranking long before LLMs existed. We are now plugging generative models directly into that poisoned pipeline and asking them to reason confidently about "truth" on our behalf. The answer is not "the model will figure it out", as the model cannot tell a real source from one I registered last Tuesday. Or how many R's are actually in the word "strawberry".

**This attack and test was a $12 domain, a single Wikipedia edit, and about twenty minutes of my time.** Scale that up with a motivated adversary, a handful of seeded domains, a coordinated edit campaign across a dozen low traffic articles, and the attack surface gets interesting very quickly. Think nation states. Think politics. Think vital life saving and surival information.

This is where I think the next generation of disinformation and supply chain attacks lives. Not in compromising models at training time, but in compromising the information substrate the models retrieve at inference time.

The championship does not exist, sadly. But the trust pattern that made it briefly exist in an LLM's answer absolutely does, and we should take it seriously before it's being used for something that matters.

If a tree falls in the forest, and no one is around, does it make a sound?

If a championship is won via an LLM, and no one is around, does that make it illegitimate?