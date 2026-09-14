import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Wraps successful responses as { success, data }; serialises BigInt safely. */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => JSON.parse(JSON.stringify({ success: true, data }, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ))),
    );
  }
}
