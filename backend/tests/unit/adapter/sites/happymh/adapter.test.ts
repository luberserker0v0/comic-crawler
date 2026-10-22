import { HappyMhAdapter } from '../../../../../src/adapter/sites/happymh';

let adapter: HappyMhAdapter;

describe('HappyMhAdapter', () => {
  HappyMhAdapterTestGroup1();
});

function HappyMhAdapterTestGroup1(): void {
  beforeEach(HappyMhAdapterTestScenario1);
  afterEach(HappyMhAdapterTestScenario2);
  it('matches HappyMH manga catalog and chapter URLs', HappyMhAdapterTestMatchesHappyMHMangaCatalogAndChapterURLs);
  it('declares adapter capabilities without claiming bundled HappyMH fixtures', HappyMhAdapterTestDeclaresAdapterCapabilitiesWithoutClaimingBundledHappyMHFixtures);
  it('extracts tags and same-manga chapter links from the catalog DOM contract', HappyMhAdapterTestExtractsTagsAndSameMangaChapterLinksFromTheCatalogDOMContract);
}

function HappyMhAdapterTestScenario1() {
    adapter = new HappyMhAdapter();
}

async function HappyMhAdapterTestScenario2() {
    await adapter.dispose();
}

function HappyMhAdapterTestMatchesHappyMHMangaCatalogAndChapterURLs() {
    expect(adapter.matchUrl('https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu')).toBe(true);
    expect(adapter.matchUrl('https://m.happymh.com/mangaread/wozaixingjiguojiadangedelingzhu/3279871')).toBe(true);
    expect(adapter.matchUrl('https://happymh.com/manga/demo')).toBe(false);
}

function HappyMhAdapterTestDeclaresAdapterCapabilitiesWithoutClaimingBundledHappyMHFixtures() {
    expect(adapter.capabilities).toEqual({
        verification: true,
        metadata: true,
        chapterImages: true,
    });
    expect(adapter.parseMode).toBe('playwright');
}

async function HappyMhAdapterTestExtractsTagsAndSameMangaChapterLinksFromTheCatalogDOMContract() {
    const url = 'https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu';
    const document = adapter.parseHtml(HAPPY_MH_CATALOG_HTML);
    expect(await adapter.extractTags(document, url)).toEqual(['\u79d1\u5e7b', '\u5192\u9669', '\u8f7b\u5c0f\u8bf4', '\u9b54\u5e7b']);
    const chapters = await adapter.extractChapterList(document, url);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['\u7b2c34\u8bdd', '\u7b2c33\u8bdd', '\u7b2c25\u8bdd', '\u7b2c01\u8bdd']);
    expect(chapters.every((chapter) => chapter.url.includes('/wozaixingjiguojiadangedelingzhu/'))).toBe(true);
}

const HAPPY_MH_CATALOG_HTML = `
      <main class="mg-detail">
        <a>\u704c\u5cf6\u304b\u3044</a>
        <a>\u4e09\u5d8b\u4e0e\u5922</a>
        <a>\u79d1\u5e7b</a>
        <a>\u5192\u9669</a>
        <a>\u8f7b\u5c0f\u8bf4</a>
        <a>\u9b54\u5e7b</a>
      </main>
      <div id="detail-app">
        <a href="/mangaread/wozaixingjiguojiadangedelingzhu/6628196">\u7b2c34\u8bdd</a>
        <a href="/mangaread/wozaixingjiguojiadangedelingzhu/6524264">\u7b2c33\u8bdd</a>
        <a href="/mangaread/wozaixingjiguojiadangedelingzhu/3279870">\u5f00\u59cb\u9605\u8bfb</a>
      </div>
      <div class="MuiList-root MuiList-padding MuiList-dense css-1ontqvh">
        <a href="/mangaread/wozaixingjiguojiadangedelingzhu/6628196">\u7b2c34\u8bdd</a>
        <a href="/mangaread/wozaixingjiguojiadangedelingzhu/6056812">\u7b2c25\u8bdd</a>
        <a href="/mangaread/wozaixingjiguojiadangedelingzhu/3279870">\u7b2c01\u8bdd</a>
      </div>
      <aside>
        <a href="/mangaread/other-title/1">\u4f60\u53ef\u80fd\u4e5f\u559c\u6b22\u7b2c01\u8bdd</a>
      </aside>
    `;
