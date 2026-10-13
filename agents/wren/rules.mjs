// Pure checks for Wren's plans (wren.mjs). No I/O at import or call time, so the offline tests can load them.
// Guest-written text (idea bodies, display names, the story path) is data for the brain, never instructions, and a
// saved plan must not carry links, handles, requests for lettering or logos, or named real people/brands/characters.

/** Guest-written text (an idea body, a display name) for the brain: one quoted JSON string, no angle brackets. */
export const asData = (text, max = 300) => JSON.stringify(String(text ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max));
/** A guest-written block (the story path) placed between tags: angle brackets removed so it cannot close them. */
export const dataBlock = (text) => String(text ?? "").replace(/[<>]/g, " ");

const URL_LIKE = /\b(?:https?:\/\/|www\.)\S|\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|ai|app|dev|gg|tv|xyz|me|co|ly|info|biz|shop|site|online|link|art|page|club|live|store|social)\b/i;
const HANDLE = /(?:^|[^\w@.])@[A-Za-z0-9_]{2,}/;
const TRADEMARK = /[™®©]/;
// "in the style of <Name>" (an artist, a studio or a franchise); a generic style ("of a classic storybook") is fine.
const STYLE_OF = /\b[Ii]n the (?:style|manner) of\s+(?!(?:a|an|the|old|classic|vintage|traditional|storybook|picture|children)\b)[A-Z]/;
// Words that ask for something written. Strong ones are refused anywhere; the rest only in the image brief.
const STRONG = /\b(?:lettering|logos?|trademarks?|watermarks?|slogans?|hashtags?|brand names?|typography|calligraphy|graffiti)\b/gi;
// ("signature" is left out: "her signature yellow scarf" is a likely phrase, and the vision review rejects signatures.)
const MEDIUM = /\b(?:text|letters|words|writing|written|inscriptions?|inscribed|engraved|engraving|labels?|numerals|digits|numbers|signs?|signage|signboards?|banners?|posters?|billboards?|placards?|plaques?)\b/gi;
// Words in double quotes after a writing verb ('a sign that reads "Home"', 'a stone carved with "Luna"').
const QUOTED_WRITING = /\b(?:reads?|says?|spells?|spelled|spelt|spelling|written|writes?|wrote|inscribed|engraved|carved|etched|painted|printed|stamped|stitched|embroidered|lettered|labell?ed|titled|marked)\b[^.!?\n"“”«»]{0,30}["“«][^"“”«»]{1,60}["”»]/i;
// Famous names a simple check can catch (case-sensitive; ambiguous ordinary words are left out on purpose).
// Unicode-aware edges, so a name that ends in an accented letter (Beyoncé) is still matched.
const NAMED = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[
  "Coca-Cola", "Pepsi", "Nike", "Adidas", "iPhone", "iPad", "MacBook", "Google", "Microsoft", "Disney", "Pixar", "DreamWorks", "LEGO", "Lego",
  "Starbucks", "McDonald'?s", "Netflix", "Nintendo", "PlayStation", "Xbox", "Tesla", "Facebook", "Instagram", "TikTok", "YouTube", "Twitter",
  "Spotify", "Walmart", "Mattel", "Hasbro", "Barbie", "Hello Kitty", "Sanrio", "Red Bull", "Ferrari", "Lamborghini", "Rolex", "Gucci",
  "Louis Vuitton", "Chanel", "Oreo", "Nutella", "IKEA", "OpenAI", "ChatGPT",
  "Pok[eé]mon", "Pikachu", "Zelda", "Mickey Mouse", "Minnie Mouse", "Donald Duck", "Winnie[- ]the[- ]Pooh", "Batman", "Superman",
  "Spider-?Man", "Wonder Woman", "Iron Man", "Avengers", "Harry Potter", "Hogwarts", "Hermione", "Gandalf", "Star Wars", "Darth Vader",
  "Yoda", "Shrek", "Snoopy", "Peppa Pig", "Bluey", "SpongeBob", "Totoro", "Ghibli", "Paddington", "Peter Pan", "Tinker ?Bell",
  "Garfield", "Scooby-?Doo", "Pac-?Man", "Minecraft", "Fortnite", "Roblox",
  "Taylor Swift", "Beyonc[eé]", "Elon Musk", "Donald Trump", "Trump", "Biden", "Obama", "Kardashian", "Bieber", "Rihanna", "Oprah",
  "Einstein", "Shakespeare", "Van Gogh", "Picasso", "Banksy", "Miyazaki", "Zuckerberg", "Bezos", "Kanye", "Messi", "Ronaldo", "LeBron",
  "Queen Elizabeth", "King Charles", "Putin",
].join("|")})(?![\\p{L}\\p{N}_])`, "gu");

// A keyword right after "no", "without", "free of", … (with only other such words between) is a refusal, not a request.
const NEGATOR = /\b(?:no|not|never|without|nor|zero|none|avoid(?:ing)?|free of)\b/gi;
const LIST_GAP = /^(?:[\s,/&]|\b(?:or|and|any|other|visible|readable|legible|written|real|kind of|kinds of|sort of|lettering|letters?|words?|text|texts|writing|inscriptions?|signatures?|logos?|trademarks?|watermarks?|slogans?|hashtags?|brands?|brand names?|labels?|numerals|digits|numbers|signs?|signage|signboards?|banners?|posters?|billboards?|placards?|plaques?|typography|calligraphy|graffiti|famous|characters?|people|persons?)\b)*$/i;
function negated(text, index) {
  const before = text.slice(Math.max(0, index - 80), index);
  let last = null;
  for (const m of before.matchAll(NEGATOR)) last = m;
  return last !== null && LIST_GAP.test(before.slice(last.index + last[0].length));
}
const positiveHits = (text, pattern) => [...new Set([...text.matchAll(pattern)].filter((m) => !negated(text, m.index)).map((m) => m[0]))];

/**
 * Problems that make a plan unusable (an empty list means none). Checked: links and @handles in the idea note
 * (outside the credited guest's display name, which is theirs to choose), the title, the captions and the image
 * brief; and in the title, captions and brief, named real people, brands or famous characters, trademark signs,
 * named styles, and requests for written words, lettering or logos.
 */
export function planContentProblems(plan, { creditedLabel = null } = {}) {
  const problems = [];
  const fields = [["title", String(plan?.title ?? "")], ...(plan?.captions ?? []).map((c, i) => [`caption ${i + 1}`, String(c)]), ["imagePrompt", String(plan?.imagePrompt ?? "")]];
  const note = String(plan?.ideaNote ?? "");
  for (const [field, text] of [["ideaNote", creditedLabel ? note.split(creditedLabel).join(" ") : note], ...fields]) {
    if (URL_LIKE.test(text)) problems.push(`${field} contains a link or web address; never include one`);
    if (HANDLE.test(text)) problems.push(`${field} contains an @handle; never include one`);
  }
  for (const [field, text] of fields) {
    const named = positiveHits(text, NAMED);
    if (named.length) problems.push(`${field} names a real person, brand or famous character (${named.join(", ")}); use none`);
    if (TRADEMARK.test(text) || STYLE_OF.test(text)) problems.push(`${field} carries a trademark sign or a named artist's or studio's style; use neither`);
    const lettering = [...positiveHits(text, STRONG), ...(field === "imagePrompt" ? positiveHits(text, MEDIUM) : [])];
    if (lettering.length || QUOTED_WRITING.test(text))
      problems.push(`${field} asks for written words, lettering or a logo in the picture${lettering.length ? ` (${[...new Set(lettering)].join(", ")})` : ""}; describe a scene with nothing written in it`);
  }
  return problems;
}
