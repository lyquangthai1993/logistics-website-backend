import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';

@Entity({
  name: 'cron_job_execution_log',
})
export class CronJobExecutionLogEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_cron_job_exec_log_jobKey')
  @Column({ type: String, length: 80, nullable: false })
  jobKey: string;

  @Index('IDX_cron_job_exec_log_targetDate')
  @Column({ type: String, length: 10, nullable: false })
  targetDate: string;

  @Column({ type: String, length: 10, nullable: false })
  targetEndDate: string;

  @Column({ type: String, length: 120, nullable: false })
  windowLabel: string;

  /** CRON_SCHEDULED | MANUAL_RERUN | MANUAL_RANGE | STARTUP_INIT */
  @Column({ type: String, length: 30, nullable: false })
  triggeredBy: string;

  @Column({ type: 'int', nullable: true })
  actorUserId: number | null;

  @Column({ type: String, length: 255, nullable: true })
  actorEmail: string | null;

  /** SUCCESS | FAILED | RUNNING */
  @Index('IDX_cron_job_exec_log_status')
  @Column({ type: String, length: 20, nullable: false, default: 'SUCCESS' })
  status: string;

  @Column({ type: 'int', nullable: false, default: 1 })
  processedDays: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  upsertedHubRows: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  totalInboundCbm: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  totalInboundTons: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  totalInboundTrips: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  totalOutboundCbm: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  totalOutboundTons: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  totalOutboundTrips: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  durationMs: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Index('IDX_cron_job_exec_log_startedAt')
  @Column({
    type: 'timestamp',
    nullable: false,
    default: () => 'CURRENT_TIMESTAMP',
  })
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
