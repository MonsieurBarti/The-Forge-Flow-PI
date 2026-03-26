import { DateProviderPort } from "@kernel/ports/date-provider.port";

export class SystemDateProvider extends DateProviderPort {
  now(): Date {
    return new Date();
  }
}
