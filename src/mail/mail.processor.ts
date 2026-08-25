import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MailerService } from '../mailer/mailer.service';

@Processor('mail')
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailerService: MailerService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(
      `⚙️ [MailProcessor] Processing Job #${job.id} [${job.name}] for "${job.data.to}" (Attempt ${job.attemptsMade + 1})`,
    );

    const startTime = Date.now();
    try {
      await this.mailerService.sendMail(job.data);
      const elapsed = Date.now() - startTime;
      this.logger.log(
        `✅ [MailProcessor] Successfully completed Job #${job.id} in ${elapsed}ms`,
      );
    } catch (error) {
      this.logger.error(
        `❌ [MailProcessor] Job #${job.id} failed on attempt ${job.attemptsMade + 1}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
