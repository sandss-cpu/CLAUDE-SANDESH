import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PlaceType, Role } from '@prisma/client';
import { PlacesService } from './places.service';
import { CreatePlaceDto, NearbyQueryDto } from './dto/place.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('places')
export class PlacesController {
  constructor(private places: PlacesService) {}

  @Public() @Get('nearby')
  nearby(@Query() q: NearbyQueryDto) { return this.places.nearby(q); }

  @Public() @Get('bounds')
  bounds(
    @Query('minLat') minLat: string, @Query('minLng') minLng: string,
    @Query('maxLat') maxLat: string, @Query('maxLng') maxLng: string,
  ) {
    return this.places.inBounds(Number(minLat), Number(minLng), Number(maxLat), Number(maxLng));
  }

  @Public() @Get('type/:type')
  byType(@Param('type') type: PlaceType) { return this.places.listByType(type); }

  @Public() @Get('map-packs')
  mapPacks() { return this.places.mapPacks(); }

  @Public() @Get('altitude-check')
  altitude(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.places.altitudeCheck(Number(lat), Number(lng));
  }

  @Public() @Get('destinations')
  destinations(@Query('q') q?: string) { return this.places.listDestinations(q); }

  @Public() @Get('destinations/:slug')
  destination(@Param('slug') slug: string) { return this.places.getDestination(slug); }

  @Roles(Role.EDITOR, Role.ADMIN) @Post()
  create(@Body() dto: CreatePlaceDto) { return this.places.create(dto); }
}
