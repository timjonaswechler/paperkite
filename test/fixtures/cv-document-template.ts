// Entirely synthetic template/data for CV integration tests, not copied from a user's CV.
export function cvDocumentTemplate() {
  const commands = String.raw`\newcommand{\Name}[2]{#1 #2\par}
\newcommand{\Strasse}[1]{}\newcommand{\TelefonNummer}[1]{}\newcommand{\Email}[1]{#1\par}
\newcommand{\Ort}[1]{}\newcommand{\Geburtstag}[1]{}\newcommand{\Geburtsort}[1]{}
\newcommand{\FotoPfad}[1]{}\newcommand{\SignaturPfad}[1]{}\newcommand{\PlzOrt}[1]{}\newcommand{\Header}{}
\newcommand{\AkzentFarbe}[1]{}\newcommand{\Unterschrift}{SignatureMarker}
\newenvironment{Abschnitt}[1]{\section*{#1}}{}
\newenvironment{cvdetails}[3]{#1 #2 #3\par}{}
\newenvironment{cvbullets}{\begin{itemize}}{\end{itemize}}
\newcommand{\cvrow}[2]{#1 #2\par}
\newcommand{\cvsmallitem}[2]{#1 #2\par}
\newcommand{\cveducation}[5]{#1 #2 #3 #4 #5\par}
`;
  const files = {
    "cv/Lebenslauf.tex": String.raw`\documentclass{article}
\usepackage{luacode}
\input{preamble/commands}
\begin{document}
\begin{luacode*}
local data=require('lua/loader').load(os.getenv('CV_PROFILE') or 'general')
require('lua/validate').run(data)
require('lua/formatter').render(data)
\end{luacode*}
\end{document}
`,
    "cv/preamble/commands.tex": commands,
    "cv/lua/loader.lua":
      'return {load=function(name) return {personal=require("profile/personal"),education=require("profile/education"),profile=require("profiles/"..name)} end}',
    "cv/lua/validate.lua": "return {run=function() end}",
    "cv/lua/formatter.lua": String.raw`return {render=function(cv) tex.print("\\AkzentFarbe{14,31,83}") tex.print(cv.personal.first_name) end}`,
    "cv/profile/personal.lua":
      'return { first_name="Demo",last_name="Person",email="demo@example.invalid",sections={"education","experience","skills","engagement"},education={"selected"},extra={keep=true} }',
    "cv/profile/education.lua":
      'return { selected={date="2020 – 2024",degree="DegreeMarker",subtitle="FieldMarker",grade="1,7",org="SchoolMarker",extra={keep=true}}, unused={date="2000",degree="UnusedMarker",org="OtherSchool"} }',
    "cv/profiles/general.lua":
      'return { experience={{date="2024 – heute",title="PositionMarker",org="CompanyMarker",bullets={"BulletMarkerA","BulletMarkerB"},extra={keep=true}}}, engagement={}, skills={{label="Technology",items={"Lua","TeX"}}},custom={keep=true} }',
  };
  return {
    format: "bewerbung-template-v1",
    files: Object.fromEntries(
      Object.entries(files).map(([p, s]) => [
        p,
        Buffer.from(s).toString("base64"),
      ]),
    ),
  };
}
