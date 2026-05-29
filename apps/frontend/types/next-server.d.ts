declare module 'next/server' {
  export interface NextRequest extends Request {
    nextUrl: URL;
  }

  export class NextResponse extends Response {
    constructor(body?: BodyInit | null, init?: ResponseInit);
    static json(body: unknown, init?: ResponseInit): NextResponse;
  }
}
