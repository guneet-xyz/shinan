import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  buildSkillCatalog,
  loadSkillCatalog,
  SkillCatalogError,
  skillLimits,
} from "./index.js"

const text = (s: string) => new TextEncoder().encode(s)
const skill = "---\nname: Test\ndescription: A test skill\n---\n\n# Test\n"

const read = (body: Uint8Array) => new TextDecoder().decode(body)

describe("buildSkillCatalog", () => {
  it("lists the one skill in index.json, SKILL.md first", () => {
    const catalog = buildSkillCatalog([
      { path: "references/b.md", body: text("b") },
      { path: "SKILL.md", body: text(skill) },
      { path: "references/a.md", body: text("a") },
    ])
    const index = catalog.files.get("index.json")!
    expect(index.contentType).toBe("application/json; charset=utf-8")
    expect(JSON.parse(read(index.body))).toEqual({
      skills: [
        {
          name: "shinan",
          version: catalog.version,
          files: ["SKILL.md", "references/a.md", "references/b.md"],
        },
      ],
    })
    expect([...catalog.files.keys()].sort()).toEqual([
      "index.json",
      "shinan/SKILL.md",
      "shinan/references/a.md",
      "shinan/references/b.md",
    ])
    const file = catalog.files.get("shinan/SKILL.md")!
    expect(read(file.body)).toBe(skill)
    expect(file.contentType).toBe("text/markdown; charset=utf-8")
    expect(file.etag).toMatch(/^"[A-Za-z0-9_-]{27}"$/)
  })

  it("changes the version exactly when a file's name or content changes", () => {
    const base = [
      { path: "SKILL.md", body: text(skill) },
      { path: "references/a.md", body: text("a") },
    ]
    const version = buildSkillCatalog(base).version
    expect(buildSkillCatalog([...base].reverse()).version).toBe(version)
    expect(
      buildSkillCatalog([
        base[0]!,
        { path: "references/a.md", body: text("A") },
      ]).version,
    ).not.toBe(version)
    expect(
      buildSkillCatalog([
        base[0]!,
        { path: "references/c.md", body: text("a") },
      ]).version,
    ).not.toBe(version)
    expect(buildSkillCatalog([base[0]!]).version).not.toBe(version)
  })

  it.each([
    "../SKILL.md",
    "references/../x.md",
    "/etc/x.md",
    ".hidden.md",
    "references/.x.md",
    "notes.txt",
    "index.json",
    "a b.md",
    "a/b/c/d.md",
    "references\\x.md",
    "x%2e.md",
  ])("refuses the path %s", (path) => {
    expect(() =>
      buildSkillCatalog([
        { path: "SKILL.md", body: text(skill) },
        { path, body: text("x") },
      ]),
    ).toThrow(SkillCatalogError)
  })

  it("refuses a catalog without SKILL.md, too large, or not UTF-8", () => {
    expect(() =>
      buildSkillCatalog([{ path: "README.md", body: text("x") }]),
    ).toThrow(/no SKILL.md/)
    expect(() =>
      buildSkillCatalog([
        {
          path: "SKILL.md",
          body: new Uint8Array(skillLimits.fileBytes + 1),
        },
      ]),
    ).toThrow(/larger than/)
    expect(() =>
      buildSkillCatalog([
        { path: "SKILL.md", body: text(skill) },
        ...Array.from({ length: skillLimits.files }, (_, i) => ({
          path: `f${i}.md`,
          body: text("x"),
        })),
      ]),
    ).toThrow(/more than/)
    expect(() =>
      buildSkillCatalog([
        { path: "SKILL.md", body: new Uint8Array([0x23, 0xff, 0xfe]) },
      ]),
    ).toThrow(/not UTF-8/)
  })
})

describe("loadSkillCatalog", () => {
  let dir: string | undefined
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  it("serves the skill's own files", async () => {
    const catalog = await loadSkillCatalog()
    const index = JSON.parse(read(catalog.files.get("index.json")!.body)) as {
      skills: { name: string; files: string[] }[]
    }
    expect(index.skills).toHaveLength(1)
    expect(index.skills[0]!.name).toBe("shinan")
    expect(index.skills[0]!.files).toEqual([
      "SKILL.md",
      "references/changing.md",
      "references/facts.md",
      "references/reading.md",
    ])
    const main = read(catalog.files.get("shinan/SKILL.md")!.body)
    // OpenCode advertises a skill only when it has a description.
    expect(main).toMatch(/^---\nname: Shinan\ndescription: \S/)
  })

  it("links only to files the catalog serves", async () => {
    const catalog = await loadSkillCatalog()
    for (const [path, file] of catalog.files) {
      if (!path.endsWith(".md")) continue
      const folder = path.split("/").slice(0, -1).join("/")
      for (const [, target] of read(file.body).matchAll(
        /\]\(([^)#\s]+)(?:#[^)]*)?\)/g,
      )) {
        if (/^https:\/\//.test(target!)) continue
        const resolved = new URL(target!, `http://x/${folder}/`).pathname.slice(
          1,
        )
        expect(catalog.files.has(resolved), `${path} → ${target}`).toBe(true)
      }
    }
  })

  it("refuses anything but plain Markdown files", async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-"))
    await writeFile(join(dir, "SKILL.md"), skill)
    await mkdir(join(dir, "references"))
    await writeFile(join(dir, "references", "a.md"), "a")
    expect(
      (await loadSkillCatalog(dir)).files.has("shinan/references/a.md"),
    ).toBe(true)
    await symlink("/etc/hostname", join(dir, "references", "link.md"))
    await expect(loadSkillCatalog(dir)).rejects.toThrow(/not a plain file/)
    await rm(join(dir, "references", "link.md"))
    await writeFile(join(dir, ".env"), "x")
    await expect(loadSkillCatalog(dir)).rejects.toThrow(/plain Markdown/)
  })
})
