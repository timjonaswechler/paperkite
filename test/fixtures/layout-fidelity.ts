import fs from "node:fs";
import type { FormSpec, Values } from "../../shared/cv-form.ts";
import type { CoverLetter } from "../../shared/api.ts";
import { emptyApplicantProfile } from "../../shared/applicant-profile.ts";

// Hand-authored originals and independently specified binding inputs; no user template data.
const fonts = Buffer.from(
  String.raw`\usepackage{fontspec}\setmainfont{Latin Modern Roman}`,
);
const render = Buffer.from(String.raw`
local d=dofile('data.lua')
local escapes={['\\']='\\textbackslash{}',['#']='\\#',['$']='\\$',['%']='\\%',['&']='\\&',['_']='\\_',['{']='\\{',['}']='\\}',['~']='\\textasciitilde{}',['^']='\\textasciicircum{}'}
local function text(v) return (tostring(v or ''):gsub('.',function(c) return escapes[c] or c end)) end
local function lines(v) for line in (tostring(v or '')..'\n'):gmatch('(.-)\n') do tex.print(text(line)..'\\par') end end
if d.kind=='cover' then
 local f=d.fields
 lines(f.sender);tex.print('\\vspace{12mm}');lines(f.recipient)
 tex.print('\\vspace{6mm}\\textbf{'..text(f.subject)..'}\\par\\medskip')
 lines(f.salutation);tex.print('\\medskip');lines(f.body);tex.print('\\medskip');lines(f.closing)
else
 local v=d.values
 tex.print('\\section*{'..text(v.identity)..'}');lines(v.postal)
 tex.print('\\section*{Experience}')
 for _,e in ipairs(v.timeline or {}) do
  tex.print('\\textbf{'..text(e.values.position)..'}\\hfill '..text(e.values.period)..'\\par')
  for _,b in ipairs(e.values.description or {}) do
   if b.type=='paragraph' then lines(b.text) else for _,i in ipairs(b.items) do tex.print('\\noindent\\textbullet\\quad '..text(i.text)..'\\par') end end
  end
 end
end
`);
const main = (cover: boolean) =>
  Buffer.from(String.raw`\documentclass[11pt,a4paper]{article}
\input{fonts.tex}\usepackage{luacode}\usepackage{graphicx}\usepackage[margin=${cover ? "27" : "21"}mm]{geometry}
\pagestyle{empty}\parindent=0pt
\begin{document}
\begin{flushright}\includegraphics[width=14mm]{assets/logo.png}\end{flushright}
\begin{luacode*}
dofile('render.lua')
\end{luacode*}
\vfill\small LayoutReference2026
\end{document}`);
export const referenceProfile = {
  ...emptyApplicantProfile(),
  firstName: "Erika",
  lastName: "Example",
  street: "Straße & Weg_7",
  postalCode: "01067",
  city: "Dresden",
};
export const cvReferenceValues: Values = {
  identity: "Erika Example",
  postal: "Straße & Weg_7\n01067 Dresden",
  timeline: [
    {
      id: "job-a",
      included: true,
      values: {
        position: "Research & Development",
        period: "2020 – 2024",
        description: [
          {
            id: "p-a",
            type: "paragraph",
            text: "IndependentReference31 with 50% & Rust_2026.",
          },
          {
            id: "b-a",
            type: "bulletList",
            items: [{ id: "i-a", text: "IndependentBullet37" }],
          },
        ],
      },
    },
  ],
};
export const coverReferenceFields: CoverLetter = {
  sender: "Erika Example\nStraße & Weg_7\n01067 Dresden",
  recipient: "RecipientCompany41\nRecipientAddress43",
  subject: "Application 50% & Research_2026",
  salutation: "Dear committee,",
  body: "IndependentParagraph47\n\nIndependentParagraph53 with 50% & Rust_2026.",
  closing: "Kind regards,",
};
const cvLiteral = Buffer.from(
  String.raw`return {schemaVersion=2,values={identity='Erika Example',postal='Straße & Weg_7\n01067 Dresden',timeline={{id='job-a',included=true,values={position='Research & Development',period='2020 – 2024',description={{id='p-a',type='paragraph',text='IndependentReference31 with 50% & Rust_2026.'},{id='b-a',type='bulletList',items={{id='i-a',text='IndependentBullet37'}}}}}}}}}`,
);
const coverLiteral = Buffer.from(
  String.raw`return {schemaVersion=1,kind='cover',fields={sender='Erika Example\nStraße & Weg_7\n01067 Dresden',recipient='RecipientCompany41\nRecipientAddress43',subject='Application 50% & Research_2026',salutation='Dear committee,',body='IndependentParagraph47\n\nIndependentParagraph53 with 50% & Rust_2026.',closing='Kind regards,'}}`,
);
export function layoutFixture(cover: boolean) {
  const original: Record<string, Buffer> = {
    "main.tex": main(cover),
    "fonts.tex": fonts,
    "render.lua": render,
    "data.lua": cover ? coverLiteral : cvLiteral,
    "assets/logo.png": fs.readFileSync(
      new URL("./applicant-signatures/rgb.png", import.meta.url),
    ),
  };
  const form: FormSpec = {
    format: "bewerbung-cv-form-v2",
    engine: "lualatex",
    entrypoint: "main.tex",
    form: [
      { type: "text", key: "identity", label: "Name", target: "pdf" },
      { type: "text", key: "postal", label: "Address", target: "pdf" },
      {
        type: "entries",
        key: "timeline",
        label: "Experience",
        children: [
          { type: "text", key: "position", label: "Position", target: "pdf" },
          { type: "text", key: "period", label: "Period", target: "pdf" },
          {
            type: "content",
            key: "description",
            label: "Description",
            target: "pdf",
          },
        ],
      },
    ],
    applicant: {
      fields: { identity: "name", postal: "address" },
      signature: "none",
    },
  };
  const manifest = cover
    ? {
        format: "bewerbung-cover-mod-v1" as const,
        engine: "lualatex" as const,
        entrypoint: "main.tex",
        applicant: {
          fields: { sender: "sender" as const },
          signature: "none" as const,
        },
      }
    : form;
  const mod = {
    ...original,
    "data.lua": Buffer.from("return dofile(os.getenv('CV_DATA_FILE'))\n"),
    "mod.json": Buffer.from(JSON.stringify(manifest)),
  };
  return { original, mod, form, manifest };
}
