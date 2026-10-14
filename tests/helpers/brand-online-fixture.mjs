export function brandOnlineResponse(name) {
  const sourceUrl="https://brand-fixture.com/"+encodeURIComponent(name.toLowerCase());
  return {
    status:"completed",
    output:[
      {type:"web_search_call",status:"completed",action:{type:"search",query:name+" official website"}},
      {type:"message",status:"completed",content:[{
        type:"output_text",
        text:`Search found ${name} products.`,
        annotations:[{type:"url_citation",url:sourceUrl,title:`${name} Products`}],
      }]},
    ],
  };
}
