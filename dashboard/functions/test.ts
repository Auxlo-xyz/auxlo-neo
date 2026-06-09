export default {
  async fetch(req: Request, env: any) {
    return new Response("Hello from Functions!")
  }
}
