local data = dofile(assert(os.getenv('LETTER_DATA_FILE')))
assert(data.kind == 'cover' and data.schemaVersion == 1)
local f = data.fields
local replacements = {['\\']='\\textbackslash{}',['{']='\\{',['}']='\\}',['%']='\\%',['&']='\\&',['_']='\\_',['$']='\\$',['#']='\\#',['^']='\\textasciicircum{}',['~']='\\textasciitilde{}'}
local function escaped(text)
  return (text:gsub('[\\{}%%&_$#%^~]', function(c) return replacements[c] end))
end
local function text(value)
  local paragraphs = {}
  for paragraph in (value .. '\n\n'):gmatch('(.-)\n\n') do
    paragraphs[#paragraphs+1] = escaped(paragraph):gsub('\n', '\\newline{}')
  end
  tex.print(table.concat(paragraphs, '\\par '))
  tex.print('\\par\\smallskip')
end
for _,key in ipairs({'sender','recipient','subject','salutation','body','closing'}) do text(f[key]) end
tex.print('\\null')
