export function brandOnlineResponse(name, overrides={}) {
  const officialUrl="https://brand-fixture.com/"+encodeURIComponent(name.toLowerCase());
  return {
    status:"completed",
    output:[
      {type:"web_search_call",status:"completed",action:{type:"search",query:name+" official website"}},
      {type:"message",status:"completed",content:[{
        type:"output_text",
        text:`Evidence from the official source.\n${JSON.stringify({name,confirmed:true,ambiguous:false,officialUrl,sourceQuote:`${name} official commercial brand`,...overrides})}`,
        annotations:[{type:"url_citation",url:officialUrl,title:`${name} Official Website`}],
      }]},
    ],
  };
}
