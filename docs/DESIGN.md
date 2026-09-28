# Design notes

Why the screens look the way they do. Each rule below names the study it rests on, so a later change can
be checked against the evidence rather than against taste. The values live in `site/style.css` under
"type scale"; the classes are listed at the end.

## 1. Heading levels differ mainly in size, by about a third

**Rule.** Each text level is about 1.33 times the one below it: body 15 px, subsection 20 px, section
27 px, page title 36 px. Levels differ only in size and weight, never in colour, case or typeface.

**Evidence.** Williams and Spyridakis asked readers to tell heading levels apart. Size was the most
powerful cue to a heading's position in the hierarchy; relative size differences of about 20% between
levels were more discriminable than absolute differences; and headings were easier to discriminate when
they varied on fewer formatting dimensions rather than more.

**What changed because of it.** The first version had subsection headings at 17 px over 15.5 px body
text, a 10% step, and readers could not see which was which. Small grey upper-case labels ("HOW THEY
LEARN") were used as subsection headings; they differed from body text in case, colour and size at once
and still did not read as headings. Both were replaced by the scale above.

> Williams, T. R., & Spyridakis, J. H. (1992). Visual discriminability of headings in text.
> *IEEE Transactions on Professional Communication*, 35(2), 64–70.
> https://www.researchgate.net/publication/3229797_Visual_Discriminability_of_Headings_in_Text

## 2. All headings are bold

**Rule.** Every heading level uses weight 700; body text uses 400.

**Evidence.** Timpany compared seven ways of typographically marking headings, in print and on screen,
with paired comparisons. The headings with the greatest typographic weight were judged easiest to
identify in both media.

> Timpany, C. (2025). Identification of headings in print and screen using typographic differentiation.
> *Information Design Journal*, 30(2), 97–116. https://benjamins.com/catalog/idj.25001.tim

## 3. Content under a subsection is indented once, by two to three characters

**Rule.** A subsection heading stays flush left; the content under it is indented by `--indent` (20 px,
about two to three characters at body size). There is only one level of indentation.

**Evidence.** Miara and colleagues tested comprehension of the same program at 0, 2, 4 and 6 spaces of
indentation with novice and experienced programmers. Indentation level had a significant effect;
comprehension was best at 2–4 spaces and fell off with deeper indentation. The study used program text,
so applying it to prose is our extrapolation: we take from it that a small, single step of indentation
shows structure and a deep one costs more than it gives.

> Miara, R. J., Musselman, J. A., Navarro, J. A., & Shneiderman, B. (1983). Program indentation and
> comprehensibility. *Communications of the ACM*, 26(11), 861–867. https://doi.org/10.1145/182.358437
> (PDF: https://www.cs.umd.edu/~ben/papers/Miara1983Program.pdf)

## 4. Every block of a panel has its own heading

**Rule.** Panels are split into titled blocks ("Families", "Split next by", "How they learn",
"Examples") instead of running text, and every page opens with a title.

**Evidence.** Lorch's review of signalling devices (titles, headings, previews, typographic cues and
others) found that almost all of them improve memory for the information they cue, while memory for
uncued information is usually unaffected. In an eye-tracking study, Hyönä and Lorch found that topic
headings sped the processing of topic sentences, both on first reading and on look-backs, and increased
the number of topics readers included in summaries. Nielsen Norman Group's eye-tracking work describes
the "layer-cake" pattern: when headings stand out, people scan from heading to heading and dip into the
text between, which they call the most effective way to scan a page short of reading every word.

> Lorch, R. F. (1989). Text-signaling devices and their effects on reading and memory processes.
> *Educational Psychology Review*, 1(3), 209–234. https://doi.org/10.1007/BF01320135
>
> Hyönä, J., & Lorch, R. F. (2004). Effects of topic headings on text processing: Evidence from adult
> readers' eye fixation patterns. *Learning and Instruction*, 14(2), 131–152.
> https://eric.ed.gov/?id=EJ731658
>
> Nielsen Norman Group. The layer-cake pattern of scanning content on the web.
> https://www.nngroup.com/articles/layer-cake-pattern-scanning/ (an industry eye-tracking study, not
> peer-reviewed)

## 5. Spacing ties a heading to what follows it

**Rule.** A heading has more space above it than below it, so it sits with its own content rather than
with the block before. Section headings have 22–28 px above and about 8 px below.

**Evidence.** This follows from rule 4 (headings are only useful if it is clear what they head) and is
standard typographic practice; we have not found a controlled study that sets the ratio, so treat the
values as a default to test rather than a finding.

## 6. Two ways to see the Taxonomy map

**Rule.** The first two zoom levels of the Taxonomy can be shown as an isometric map (blocks whose height
is the paper count, descriptions in a side panel on hover) or as plain text (cards with every
description written out). The switch sits in the breadcrumb bar and is remembered per browser. The third
level, a family's papers on its own two axes, is the same in both.

**Why.** The two serve different tasks: the isometric map shows at a glance where papers pile up and
which cells are empty, while plain text is for reading what each cell and family means. This is a
product decision taken with the user, not a finding from the studies above; both views follow rules 1–5
for their text.

## Using it

| Class | Use | Value |
|---|---|---|
| `.t-h1` | page or zoom-level title | 36 px, 700 |
| `.t-h2` | panel or section title | 27 px, 700 |
| `.t-h3` | subsection | 20 px, 700 |
| `.t-body` | running text | 15 px, 400, line height 1.6 |
| `.t-meta` | counts, dates, secondary facts | 13 px, grey |
| `.t-label` | control labels such as filter names | 11.5 px, upper case |
| `.t-sec` + `.t-indent` | a subsection and its indented body | indent 20 px |

Any element that follows a `.t-h3` inside the same parent is indented automatically; add `.t-noindent`
to opt out. Change the whole site by editing `--fs-*`, `--fw-heading` and `--indent` in `:root`.
Filter labels in the side rails stay small (`.t-label`): they name controls, not content, and giving
them heading sizes would compete with the page's real headings.
