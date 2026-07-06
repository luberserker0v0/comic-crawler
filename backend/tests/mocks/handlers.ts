import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('https://example.com/comic/:id', ({ params }) => {
    return HttpResponse.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Test Comic</title></head>
        <body>
          <h1 class="title">Test Comic</h1>
          <span class="author">Test Author</span>
          <span class="status">Ongoing</span>
          <div class="chapters">
            <a href="/comic/${params.id}/chapter/1">Chapter 1</a>
            <a href="/comic/${params.id}/chapter/2">Chapter 2</a>
          </div>
        </body>
      </html>
    `);
  }),

  http.get('https://example.com/comic/:id/chapter/:chapterId', () => {
    return HttpResponse.html(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="images">
            <img src="/images/1.jpg" />
            <img src="/images/2.jpg" />
            <img src="/images/3.jpg" />
          </div>
        </body>
      </html>
    `);
  }),

  http.get('https://example.com/search', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q');

    return HttpResponse.json({
      results: [
        { id: '1', title: `${query} Result 1`, url: 'https://example.com/comic/1' },
        { id: '2', title: `${query} Result 2`, url: 'https://example.com/comic/2' },
      ],
    });
  }),
];
