local m={}
local escapes={['\\']='\\textbackslash{}',['#']='\\#',['$']='\\$',['%']='\\%',['&']='\\&',['_']='\\_',['{']='\\{',['}']='\\}',['~']='\\textasciitilde{}',['^']='\\textasciicircum{}'}
function m.text(value) return (tostring(value or ''):gsub('.',function(c) return escapes[c] or c end)) end
function m.blocks(blocks)
 for _,b in ipairs(blocks or {}) do
  if b.type=='paragraph' then tex.print(m.text(b.text)..'\\par')
  elseif b.type=='bulletList' and #b.items>0 then tex.print('\\begin{itemize}');for _,item in ipairs(b.items) do tex.print('\\item '..m.text(item.text)) end;tex.print('\\end{itemize}') end
 end
end
return m
