import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = 'Internal server error';
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : (body as any).message ?? body;
      if (typeof body === 'object' && typeof (body as any).code === 'string') code = (body as any).code;
      // ValidationPipe returns one string per failed rule; clients show a single sentence.
      if (Array.isArray(message)) message = message.join('. ');
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      code = exception.code;
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = `Already exists: ${(exception.meta?.target as string[])?.join(', ')}`;
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          message = 'Related record does not exist';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          message = 'Database request failed';
      }
    }

    if (status >= 500) this.logger.error(`${req.method} ${req.url}`, (exception as Error)?.stack);

    res.status(status).json({
      success: false, statusCode: status, code, message,
      path: req.url, timestamp: new Date().toISOString(),
    });
  }
}
