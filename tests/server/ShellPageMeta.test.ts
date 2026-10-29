import { describe, expect, test } from "vitest";
import { injectHeadMeta } from "../../src/server/SeoMeta";
import { shellPageMeta } from "../../src/server/ShellPageMeta";

const SHELL = `<html><head>
<title data-i18n="main.title">Kleopolis</title>
<meta name="description" content="old" />
<meta property="og:image" content="https://kleopolis.io/shot.png" />
<meta property="og:image:width" content="1200" >
<meta property="og:image:alt" content="The home page" />
<meta name="twitter:card" content="summary_large_image" />
</head><body></body></html>`;

describe("ShellPageMeta", () => {
  test("gives the home page a canonical URL, a title and structured data", () => {
    const meta = shellPageMeta("/", "https://kleopolis.io");
    expect(meta).not.toBeNull();
    const html = injectHeadMeta(SHELL, meta!);

    expect(html).toContain(
      '<link rel="canonical" href="https://kleopolis.io/" >',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://kleopolis.io/" >',
    );
    expect(html).toContain("<title>Kleopolis</title>");
    expect(html).not.toContain("data-i18n");
    expect(html).not.toContain('content="old"');
    // The shell's image and its size stay.
    expect(html).toContain('<meta property="og:image:width" content="1200" >');

    const json = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(
      html,
    );
    expect(json).not.toBeNull();
    const data = JSON.parse(json![1]);
    expect(data["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual([
      "WebSite",
      "VideoGame",
    ]);
  });

  test("gives the leaderboard its own canonical URL", () => {
    const meta = shellPageMeta("/leaderboard", "https://kleopolis.io");
    expect(meta?.canonical).toBe("https://kleopolis.io/leaderboard");
  });

  test("has no tags for other paths", () => {
    expect(shellPageMeta("/lobby/abc", "https://kleopolis.io")).toBeNull();
  });

  test("an own image drops the shell's image size and alt text", () => {
    const html = injectHeadMeta(SHELL, {
      title: "Game",
      description: "A game",
      image: "https://kleopolis.io/map.png",
    });
    expect(html).toContain('content="https://kleopolis.io/map.png"');
    expect(html).not.toContain("og:image:width");
    expect(html).not.toContain("og:image:alt");
  });

  test("JSON-LD cannot close its script element", () => {
    const html = injectHeadMeta(SHELL, {
      title: "x",
      description: "x",
      jsonLd: { name: "</script><script>alert(1)</script>" },
    });
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("\\u003c/script>");
  });
});
