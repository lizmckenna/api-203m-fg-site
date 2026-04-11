# A note on this project

## Why a focus group? Why this data?

**Most survey research on AI treats beliefs and behaviors as properties of individuals, as though they are stable, intrinsic attitudes you carry around and report when asked.** That framing misses something important about this particular topic. How HKS students feel about AI is being actively negotiated in conversations with classmates, in response to what you observe your peers and professors are doing, and in the gap between what instructors say and what professional norms seem to demand. It was fascinating to walk around the room on Thursday and see your opinions about AI forming and revising in real time.

**We use focus groups (rather than surveys or individual interviews) in specific circumstances, two of which apply here.** First, when the phenomenon is understudied enough that we do not yet know the right questions to ask, imposing a fixed survey instrument could foreclose the thing we most needed to discover but can't yet articulate in a question protocol. Second, and more fundamentally, when the *process* of social interaction is itself part of what we are trying to understand. In an individual interview, a respondent tells you what they think, whereas focus groups allow you to watch people figure out what they think in relation to each other. The disagreements, the moments of recognition ("I hadn't thought about it that way"), the silences after someone admits something uncomfortable, and so forth, are data.

>> The disagreements, the moments of recognition, the silences after someone admits something uncomfortable — those are data.

**AI attitudes at HKS right now have both properties.** We are in a moment of epistemic flux, where students are peer-learning norms in the absence of institutional guidance, where "using AI" covers everything from transcription and translation to light editing assistance to wholesale outsourcing of thinking, and where the costs of over-use and under-use feel very real. The focus group lets those uncertainties surface but at a cost: what we gain in depth and interaction we give up in breadth and generalizability. These eleven focus groups cannot tell us how HKS students feel about AI, but they can tell us how AI is being talked about, negotiated, and made sense of among the 90 MPP1s who were in the room.

## What this project is, and what it's trying to teach

**This site makes an argument about methods by showing the work.** The same raw utterances — e.g. the same 40-second fragment from a focus group on professional readiness — get coded four different ways: 1) deductively by a human researcher working from an a-priori framework, 2) inductively by the same researcher reading for language that emerges from the data itself, 3) deductively by a large language model following the same codebook, and 4) computationally by an embedding model that knows nothing about the focus group protocol. You will see where the approaches agree, where they diverge, and most importantly, *why* they diverge.

**The claim I'm making is that each coding approach makes a trade, and researchers who do not understand those trades may not actually be doing qualitative research but rather laundering interpretation as procedure.** (If you are intrigued by this claim, I highly recommend reading Richard Biernacki's [*Reinventing Evidence in Social Inquiry*](https://www.amazon.com/Reinventing-Evidence-Social-Inquiry-Variables/dp/1137007265), and [the very heated debate](https://orgtheory.wordpress.com/2013/04/02/biernacki-book-forum-part-1-why-we-should-think-about-coding-very-carefull/) that followed its publication; we'll talk about it on Tuesday as well.)

>> Each coding approach makes a trade, and researchers who do not understand those trades may not actually be doing qualitative research but rather laundering interpretation as procedure.

## The AI-specific cautionary tale

**There is an irony worth naming here, which is that I am using AI to analyze focus group data about AI, and also make some important points about the shortcomings of using LLMs to do qualitative coding analysis.**

**As of today, I think LLMs are useful for deductive coding at scale.** Given a well-specified codebook and a mandate to produce structured output (as shown in the examples of large-scale coding of newspaper corpora in the Tuesday 4/14 lecture), Claude applies codes faster and more consistently than a human coder working alone.

**A second affordance is what agentic AI makes possible at the level of the whole project.** Qualitative research has always had an analysis bottleneck: data collection is bounded by time and access, but the work of coding, synthesizing, and building something from the data has historically taken a *very* long time. In the three previous iterations of this course, for example, I ran a similar focus group exercise and did not build anything like this around it. By contrast, the analysis took months, and I cannot claim it produced richer findings or better results. The analysis for this year's simulation — the codebook, the coded segments, the comparative methods demonstration, the site you are reading — took a few hours over the weekend. This is not a trivial difference, in my opinion. Agentic AI (specifically Claude Code) was the difference between a pedagogical artifact that exists and one that does not.[^1]

>> Agentic AI was the difference between a pedagogical artifact that exists and one that does not.

**That said, there are real limits to what LLMs can do in qualitative analysis, and understanding those limits is as important as knowing the affordances.** We'll talk about these in class, but I'll flag a few here: First, consistency (same data in, same code out) is not the same as validity (the code actually captures what is happening in the data). The LLM does not hear things that the note-takers picked up in the metadata files, e.g. the catch in voice when they say "I mean, I'm using it, everyone is," which is something like ambivalence behind the hedge. The LLM is operating on a representation of the data (a transcript) that has already lost the paralinguistic layer (sighs, laughter, emotional register), and unless the transcript is accompanied by excellent field notes, it has no way of knowing what it lost, so it cannot flag the absence. Last, LLM YOLO coding does not generate the kind of productive friction a team of human coders generate, things like the marginalia that says, "this feels like integrity anxiety rather than displacement anxiety," or the inter-rater reliability meeting where two coders realize they have been coding the same utterance differently for six focus groups and have to stop and figure out why.

**Finally, there is a subtler cost that is easy to miss: you do not actually know your data well when you leave the analytical work to an LLM.** In my primary research, I have read and re-read transcripts until I can call up specific quotes from memory, notice when a finding in focus group seven contradicts something a respondent said in focus group two, and make connections across the corpus that were never explicitly coded. That intimacy with the material is not a byproduct of analysis, it is part of what analysis is. For this project, I can point you to a couple of striking quotes because they were surfaced by AI, but that was a function of my prompting not my knowledge. I do not have mastery over this data and I will not retain it the way I carry qualitative data that I have poured over myself. I think that is a loss worth taking stock of as you think about where and how to use these tools in your own research.[^2]

>> You do not actually know your data well when you leave the analytical work to an LLM.

**To that end, the section of this site titled "Where Claude broke" surfaces the disagreements between human and LLM coding.** Those disagreements are not bugs in the analysis, they are (hopefully) the most methodologically interesting part of this exercise. They are designed to illustrate what gets lost when speed and scale substitute for interpretation, or, to paraphrase my PhD advisor, a completely basic and foundational scholarly practice, which is the good old-fashioned, close reading of a text.

— Liz McKenna, Spring 2026

---

[^1]: In our last class session on 4/16, I will synthesize this for you into
what I'm thinking of as the ABCD framework, the notion that with agentic
AI, you can be Always Be Collecting Data. AI changes the entire research
infrastructure. You can record and transcribe in real time, archive with
consistent naming conventions and structured metadata, convert messy field
notes into clean markdown files, deploy bots to collect observations across
a vast array of people and contexts simultaneously, and move from raw data
to organized, analyzable material in hours rather than weeks, months, or
years. I believe these affordances will fundamentally change what
qualitative research is able to do.

[^2]: A note for you to think about with your PAE next year: Given the time
and access constraints, there is simply no way you/your team will be
conducting hundreds of interviews, or even dozens. You will have a
manageable corpus, so there is no excuse for not doing a close read of the
transcripts. Trust me: it will make your analysis so much better even if
you also choose to use LLMs to analyze it.
