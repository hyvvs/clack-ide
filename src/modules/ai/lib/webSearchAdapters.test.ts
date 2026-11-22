import { describe, expect, it } from "vitest";
import {
  normalizeWebProviderStatus, normalizeWebSearchEnvelope,
  normalizeWebSearchResults,
} from "./webSearchAdapters";

const provider = {
  provider:"brave_web",configured:true,available:true,reasonCode:"ready",
  credentialReference:"credential:brave-web-search",isolation:"native-network-restricted",
};
const result = (rank: number,id = "a".repeat(48)) => ({
  id,title:"Technical documentation",url:"https://docs.example.org/reference",
  snippet:"Search-index extract, not fetched evidence",rank,
  provider:"brave_web",observedAt:1795310000000,
});

describe("TF3 canonical search adapter",()=>{
  it("normalizes only native provider status and honest unavailability",()=>{
    expect(normalizeWebProviderStatus(provider)).toMatchObject({
      provider:"brave_web",version:"native-tf-web-v1",
      requiredCredentialReference:"credential:brave-web-search",
      features:["web_search"],available:true,rateStatus:"unknown",
    });
    const missing = {...provider,configured:false,available:false,
      reasonCode:"credential_not_configured"};
    expect(normalizeWebSearchEnvelope(missing,[])).toMatchObject({
      provider:"brave_web",available:false,results:[],
      reason:"credential_not_configured",
      requiredCredentialReference:"credential:brave-web-search",
    });
    expect(normalizeWebProviderStatus({...provider,configured:false,available:true}))
      .toBeNull();
    expect(normalizeWebProviderStatus({...provider,provider:"invented_provider"}))
      .toBeNull();
    expect(normalizeWebProviderStatus({provider:"brave_web",available:true}))
      .toBeNull();
    expect(normalizeWebSearchEnvelope(missing,[result(1)])).toBeNull();
  });
  it("sorts returned ranks while preserving authenticated opaque source IDs",()=>{
    const normalized=normalizeWebSearchEnvelope(provider,[
      {...result(2,"b".repeat(48)),url:"https://docs.example.org/second"},
      result(1),
    ]);
    expect(normalized?.results.map(item=>item.id)).toEqual([
      "a".repeat(48),"b".repeat(48),
    ]);
    expect(normalized?.results[0].snippet).toContain("not fetched evidence");
  });
  it("rejects malformed sources, duplicate IDs/ranks, and unbounded listings",()=>{
    expect(normalizeWebSearchResults([result(1),result(2)])).toBeNull();
    expect(normalizeWebSearchResults([result(1),result(1,"other-id")])).toBeNull();
    expect(normalizeWebSearchResults([{...result(1),url:"http://127.0.0.1"}]))
      .toBeNull();
    expect(normalizeWebSearchResults([{...result(1),url:"https://user:pass@x.test"}]))
      .toBeNull();
    expect(normalizeWebSearchResults([{...result(1),snippet:"x".repeat(2049)}]))
      .toBeNull();
    expect(normalizeWebSearchResults([{...result(1),apiKey:"untrusted"}]))
      .toBeNull();
    expect(normalizeWebSearchResults(Array.from({length:21},
      (_,index)=>result(index+1,index.toString(16).padStart(48,"0"))))).toBeNull();
    expect(normalizeWebSearchResults("pretend search results")).toBeNull();
  });
});
